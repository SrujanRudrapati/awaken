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
import { send } from '../lib/device';
import type { DeviceCommand, Quest, QuestType, Reading, Source } from '../lib/schemas';
import { AccelRepCounter, type AccelExercise } from './verifiers/accelReps';
import { JailVerifier } from './verifiers/jail';
import { LightsOutVerifier } from './verifiers/lightsout';
import { MeditateVerifier } from './verifiers/meditate';
import { PadPushupCounter } from './verifiers/padPushup';
import type { Verifier, VerifierEvent, VerifierQuest } from './verifiers/types';

type VerifierFactory = (quest: VerifierQuest) => Verifier;
type SourceVerifiers = Partial<Record<Source, Verifier>>;

/** The Watch app counts these reps on-device and posts them to /api/watch; raw readings add nothing. */
const watchCounted: VerifierFactory = () => ({ push: () => [] });

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
  punch: { watch: watchCounted },
  jail: { homebase: (quest) => new JailVerifier(quest) },
  meditate: { homebase: (quest) => new MeditateVerifier(quest) },
  lightsout: { homebase: () => new LightsOutVerifier() },
};

/** Called when a sensor quest reaches its target. The quest engine awards XP and publishes. */
export type CompletionHandler = (quest: Quest) => void;

/** Called when a timer verifier fails its quest (e.g. phone pulled from the jail). The engine applies the penalty. */
export type FailureHandler = (quest: Quest, reason: string) => void;

/** Default (no engine loaded, e.g. router tests): just announce the completion. */
const publishCompletion: CompletionHandler = (quest) =>
  publish({ type: 'quest.complete', quest, xpGained: quest.xp });

/** Default failure: announce the failed quest. */
const publishFailure: FailureHandler = (quest, reason) => {
  publish({ type: 'quest.update', quest: { ...quest, status: 'failed' } });
  publish({ type: 'penalty', playerId: quest.playerId, questId: quest.id, reason });
};

interface ActiveEntry {
  quest: Quest;
  /** One fresh verifier per source that can verify this quest type. */
  verifiers: SourceVerifiers;
  /** Reps the Watch has reported for this quest so far (its count is cumulative). */
  watchReps: number;
  /** The Phone Jail servo is locked for this quest (must be unlocked if the quest loses focus). */
  locked: boolean;
}

interface RouterState {
  active: Map<string, ActiveEntry>;
  currentPlayerId: string | null;
  onComplete: CompletionHandler;
  onFail: FailureHandler;
}

const globalForRouter = globalThis as typeof globalThis & { __awakenRouter?: RouterState };

function freshState(): RouterState {
  return { active: new Map(), currentPlayerId: null, onComplete: publishCompletion, onFail: publishFailure };
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

export function setFailureHandler(handler: FailureHandler): void {
  getState().onFail = handler;
}

/** True if some sensor source can count this quest type. */
export function hasSensorVerifier(type: QuestType): boolean {
  return Object.keys(VERIFIERS[type] ?? {}).length > 0;
}

function createVerifiers(quest: Quest): SourceVerifiers {
  const factories = VERIFIERS[quest.type] ?? {};
  return Object.fromEntries(
    Object.entries(factories).map(([source, create]) => [source, create({ target: quest.target, progress: quest.progress })]),
  ) as SourceVerifiers;
}

/** Makes `quest` the one the device's readings count toward. */
export function setActiveQuest(quest: Quest): void {
  if (quest.status !== 'active') {
    throw new Error(`Quest ${quest.id} must be active to start (status: ${quest.status})`);
  }
  const state = getState();
  releaseJail(state, state.currentPlayerId); // the old focus stops getting readings: never leave a phone locked
  releaseJail(state, quest.playerId);
  state.active.set(quest.playerId, {
    quest: { ...quest },
    verifiers: createVerifiers(quest),
    watchReps: 0,
    locked: false,
  });
  state.currentPlayerId = quest.playerId;
}

export function getActiveQuest(playerId: string): Quest | undefined {
  return getState().active.get(playerId)?.quest;
}

/** Sends UNLOCK if this player's active quest holds the Phone Jail locked. */
function releaseJail(state: RouterState, playerId: string | null): void {
  const entry = playerId ? state.active.get(playerId) : undefined;
  if (!entry?.locked) return;
  state.active.set(entry.quest.playerId, { ...entry, locked: false });
  void send('UNLOCK');
}

export function clearActiveQuest(playerId: string): void {
  const state = getState();
  releaseJail(state, playerId);
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

function applyProgress(state: RouterState, entry: ActiveEntry, value: number): void {
  const quest: Quest = { ...entry.quest, progress: value };
  state.active.set(quest.playerId, { ...entry, quest });
  publish({ type: 'quest.update', quest });
}

function applyDevice(state: RouterState, entry: ActiveEntry, cmd: DeviceCommand): void {
  if (cmd === 'LOCK' || cmd === 'UNLOCK') state.active.set(entry.quest.playerId, { ...entry, locked: cmd === 'LOCK' });
  void send(cmd);
}

function finish(state: RouterState, entry: ActiveEntry, outcome: { done: true } | { done: false; reason: string }): void {
  const { quest } = entry;
  clearActiveQuest(quest.playerId);
  if (outcome.done) state.onComplete({ ...quest, progress: quest.target, status: 'done' });
  else state.onFail(quest, outcome.reason);
}

function handle(state: RouterState, playerId: string, event: VerifierEvent, source: Source): void {
  const entry = state.active.get(playerId);
  if (!entry) return; // quest completed earlier in this batch of events
  switch (event.type) {
    case 'rep':
      applyRep(state, entry, source);
      return;
    case 'progress':
      applyProgress(state, entry, event.value);
      return;
    case 'device':
      applyDevice(state, entry, event.cmd);
      return;
    case 'done':
      finish(state, entry, { done: true });
      return;
    case 'fail':
      finish(state, entry, { done: false, reason: event.reason });
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

/** Most reps one Watch report may add (guards against a runaway or corrupt count). */
export const MAX_WATCH_REPS_PER_REPORT = 50;

export type WatchRepResult =
  | { ok: true; questId: string; applied: number; progress: number; completed: boolean }
  | { ok: false; reason: string };

/**
 * Applies reps the Apple Watch counted on-device. `count` is the Watch's cumulative count for the
 * player's active quest, so dropped or repeated reports self-correct: only the increase is added.
 * The exercise must match the active quest and the Watch must be able to verify that type.
 */
export function applyWatchReps(playerId: string, exercise: QuestType, count: number): WatchRepResult {
  const state = getState();
  const entry = state.active.get(playerId);
  if (!entry) return { ok: false, reason: 'No active sensor vow right now' };
  if (entry.quest.type !== exercise || !entry.verifiers.watch) {
    return { ok: false, reason: `The active vow is ${entry.quest.type}, not ${exercise}` };
  }
  const { id: questId } = entry.quest;
  const applied = Math.min(Math.max(0, count - entry.watchReps), MAX_WATCH_REPS_PER_REPORT);
  state.active.set(playerId, { ...entry, watchReps: entry.watchReps + applied });
  for (let i = 0; i < applied; i++) {
    const current = state.active.get(playerId);
    if (!current || current.quest.id !== questId) break; // reached the target
    applyRep(state, current, 'watch');
  }
  const after = state.active.get(playerId);
  const completed = after?.quest.id !== questId;
  return { ok: true, questId, applied, progress: completed ? entry.quest.target : (after?.quest.progress ?? 0), completed };
}
