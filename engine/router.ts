/**
 * Routes sensor readings to the active quest's verifier and publishes the results
 * (`rep`, `rep.rejected`, `quest.update`, `quest.complete`) on the bus.
 *
 * Readings belong to whichever player most recently started a quest; with no quest
 * started they are ignored here (they still reach the UI as `reading` events). Each quest gets one
 * verifier per sensor source that can verify it (VERIFIERS below) — e.g. push-ups count
 * from the Home Base pad or from the phone armband — and every source's reps add to the
 * same progress. Verifiers are pure code — nothing here asks an LLM whether a rep counted.
 * XP, level-ups and penalties are the quest engine's job (Phase 7), not the router's.
 *
 * State lives on globalThis: Next bundles each route separately and hot-reloads modules.
 */
import { publish } from '../lib/bus';
import { logEvent } from '../lib/db';
import type { Quest, QuestType, Reading, Source } from '../lib/schemas';
import { AccelRepCounter, type AccelExercise } from './verifiers/accelReps';
import { PadPushupCounter } from './verifiers/padPushup';
import type { Verifier, VerifierEvent } from './verifiers/types';

type VerifierFactory = () => Verifier;
type SourceVerifiers = Partial<Record<Source, Verifier>>;

const accel = (exercise: AccelExercise): Partial<Record<Source, VerifierFactory>> => ({
  phone: () => new AccelRepCounter(exercise),
  watch: () => new AccelRepCounter(exercise),
});

/** Which source can verify which quest type. Missing = no sensor verifier (yet). */
const VERIFIERS: Partial<Record<QuestType, Partial<Record<Source, VerifierFactory>>>> = {
  pushup: { homebase: () => new PadPushupCounter(), ...accel('armPushup') },
  squat: accel('squat'),
  jumpingjack: accel('jumpingjack'),
  situp: accel('situp'),
  // jail / meditate / lightsout arrive in Phase 8
};

/** Called when a sensor quest reaches its target. The quest engine awards XP and publishes. */
export type CompletionHandler = (quest: Quest) => void;

/** Default (no engine loaded, e.g. router tests): just announce the completion. */
const publishCompletion: CompletionHandler = (quest) =>
  publish({ type: 'quest.complete', quest, xpGained: quest.xp });

interface ActiveEntry {
  quest: Quest;
  /** One fresh verifier per source that can verify this quest type. */
  verifiers: SourceVerifiers;
}

interface RouterState {
  active: Map<string, ActiveEntry>;
  currentPlayerId: string | null;
  onComplete: CompletionHandler;
}

const globalForRouter = globalThis as typeof globalThis & { __awakenRouter?: RouterState };

function freshState(): RouterState {
  return { active: new Map(), currentPlayerId: null, onComplete: publishCompletion };
}

function getState(): RouterState {
  globalForRouter.__awakenRouter ??= freshState();
  return globalForRouter.__awakenRouter;
}

/** Test hook: forget all quests and the completion handler. */
export function resetRouter(): void {
  globalForRouter.__awakenRouter = freshState();
}

/** The quest engine registers itself here (state is global, so it survives hot reloads). */
export function setCompletionHandler(handler: CompletionHandler): void {
  getState().onComplete = handler;
}

/** True if some sensor source can count this quest type. */
export function hasSensorVerifier(type: QuestType): boolean {
  return Object.keys(VERIFIERS[type] ?? {}).length > 0;
}

function createVerifiers(type: QuestType): SourceVerifiers {
  const factories = VERIFIERS[type] ?? {};
  return Object.fromEntries(
    Object.entries(factories).map(([source, create]) => [source, create()]),
  ) as SourceVerifiers;
}

/** Makes `quest` the one the device's readings count toward. */
export function setActiveQuest(quest: Quest): void {
  if (quest.status !== 'active') {
    throw new Error(`Quest ${quest.id} must be active to start (status: ${quest.status})`);
  }
  const state = getState();
  state.active.set(quest.playerId, {
    quest: { ...quest },
    verifiers: createVerifiers(quest.type),
  });
  state.currentPlayerId = quest.playerId;
}

export function getActiveQuest(playerId: string): Quest | undefined {
  return getState().active.get(playerId)?.quest;
}

export function clearActiveQuest(playerId: string): void {
  const state = getState();
  state.active.delete(playerId);
  if (state.currentPlayerId === playerId) state.currentPlayerId = null;
}

function currentEntry(state: RouterState): ActiveEntry | undefined {
  return state.currentPlayerId ? state.active.get(state.currentPlayerId) : undefined;
}

function applyRep(state: RouterState, entry: ActiveEntry, source: Source): void {
  const { id: questId, playerId } = entry.quest;
  logEvent({ playerId, kind: 'rep', stat: entry.quest.stat, value: 1, verified: true, source });
  const quest: Quest = { ...entry.quest, progress: entry.quest.progress + 1 };
  state.active.set(playerId, { ...entry, quest });

  // Count = quest progress, so reps from several sources add up to one number.
  publish({ type: 'rep', playerId, questId, count: quest.progress });
  publish({ type: 'quest.update', quest });

  if (quest.progress < quest.target) return;
  clearActiveQuest(playerId);
  state.onComplete({ ...quest, status: 'done' });
}

function handle(state: RouterState, playerId: string, event: VerifierEvent, source: Source): void {
  const entry = state.active.get(playerId);
  if (!entry) return; // quest completed earlier in this batch of events
  if (event.type === 'rep') {
    applyRep(state, entry, source);
    return;
  }
  logEvent({ playerId, kind: 'rep.rejected', stat: entry.quest.stat, value: 1, verified: false, source });
  publish({ type: 'rep.rejected', playerId, questId: entry.quest.id, reason: event.reason });
}

export function routeReading(reading: Reading): void {
  const state = getState();
  const entry = currentEntry(state);
  if (!entry) return; // no quest started: readings only feed the live `reading` stream
  const verifier = entry.verifiers[reading.source];
  if (!verifier) return; // this source can't verify this quest type
  for (const event of verifier.push(reading)) {
    handle(state, entry.quest.playerId, event, reading.source);
  }
}
