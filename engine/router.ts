/**
 * Routes sensor readings to the active quest's verifier and publishes the results
 * (`rep`, `rep.rejected`, `quest.update`, `quest.complete`) on the bus.
 *
 * One device, so readings belong to whichever player most recently started a quest.
 * Verifiers are pure code — nothing here asks an LLM whether a rep counted.
 * XP, level-ups and penalties are the quest engine's job (Phase 7), not the router's.
 *
 * State lives on globalThis: Next bundles each route separately and hot-reloads modules.
 */
import { publish } from '../lib/bus';
import type { Quest, QuestType, Reading } from '../lib/schemas';
import { PushupCounter, assertPushupCalibration, type PushupCalibration } from './verifiers/pushup';
import { SquatCounter } from './verifiers/squat';
import type { Verifier, VerifierEvent } from './verifiers/types';

/** Until the quest-start API lands (Phase 7), an idle device runs this practice quest. */
export const PRACTICE_PLAYER_ID = 'demo';
export const PRACTICE_QUEST_ID = 'practice-pushup';
const PRACTICE_TARGET_REPS = 10;
const PRACTICE_DEADLINE_MS = 24 * 60 * 60 * 1000;

interface ActiveEntry {
  quest: Quest;
  /** null = quest type has no sensor verifier (yet). */
  verifier: Verifier | null;
}

interface RouterState {
  active: Map<string, ActiveEntry>;
  currentPlayerId: string | null;
  calibration: PushupCalibration | null;
}

const globalForRouter = globalThis as typeof globalThis & { __awakenRouter?: RouterState };

function freshState(): RouterState {
  return { active: new Map(), currentPlayerId: null, calibration: null };
}

function getState(): RouterState {
  globalForRouter.__awakenRouter ??= freshState();
  return globalForRouter.__awakenRouter;
}

/** Test hook: forget all quests and calibration. */
export function resetRouter(): void {
  globalForRouter.__awakenRouter = freshState();
}

function createVerifier(type: QuestType, calibration: PushupCalibration | null): Verifier | null {
  if (type === 'pushup') {
    const counter = new PushupCounter();
    if (calibration) counter.calibrate(calibration.upDist, calibration.downDist);
    return counter;
  }
  if (type === 'squat') return new SquatCounter();
  return null; // jail / meditate / lightsout / water arrive in Phase 8
}

function practiceQuest(): Quest {
  return {
    id: PRACTICE_QUEST_ID,
    playerId: PRACTICE_PLAYER_ID,
    stat: 'STR',
    title: 'Practice push-ups',
    type: 'pushup',
    target: PRACTICE_TARGET_REPS,
    progress: 0,
    xp: 0,
    status: 'active',
    deadline: new Date(Date.now() + PRACTICE_DEADLINE_MS).toISOString(),
  };
}

/** Makes `quest` the one the device's readings count toward. */
export function setActiveQuest(quest: Quest): void {
  if (quest.status !== 'active') {
    throw new Error(`Quest ${quest.id} must be active to start (status: ${quest.status})`);
  }
  const state = getState();
  if (quest.playerId !== PRACTICE_PLAYER_ID) state.active.delete(PRACTICE_PLAYER_ID);
  state.active.set(quest.playerId, {
    quest: { ...quest },
    verifier: createVerifier(quest.type, state.calibration),
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

export function getPushupCalibration(): PushupCalibration | null {
  return getState().calibration;
}

/** Stores the calibration and applies it to running and future push-up quests. Throws RangeError if unusable. */
export function calibratePushup(upDist: number, downDist: number): void {
  assertPushupCalibration(upDist, downDist);
  const state = getState();
  state.calibration = { upDist, downDist };
  for (const { verifier } of state.active.values()) {
    if (verifier instanceof PushupCounter) verifier.calibrate(upDist, downDist);
  }
}

function currentEntry(state: RouterState): ActiveEntry {
  const current = state.currentPlayerId ? state.active.get(state.currentPlayerId) : undefined;
  if (current) return current;
  setActiveQuest(practiceQuest());
  return state.active.get(PRACTICE_PLAYER_ID) as ActiveEntry;
}

function applyRep(state: RouterState, entry: ActiveEntry, count: number): void {
  const { id: questId, playerId } = entry.quest;
  const quest: Quest = { ...entry.quest, progress: entry.quest.progress + 1 };
  state.active.set(playerId, { ...entry, quest });

  publish({ type: 'rep', playerId, questId, count });
  publish({ type: 'quest.update', quest });

  if (quest.progress < quest.target) return;
  clearActiveQuest(playerId);
  publish({ type: 'quest.complete', quest: { ...quest, status: 'done' }, xpGained: quest.xp });
}

function handle(state: RouterState, playerId: string, event: VerifierEvent): void {
  const entry = state.active.get(playerId);
  if (!entry) return; // quest completed earlier in this batch of events
  if (event.type === 'rep') {
    applyRep(state, entry, event.count);
    return;
  }
  publish({ type: 'rep.rejected', playerId, questId: entry.quest.id, reason: event.reason });
}

export function routeReading(reading: Reading): void {
  const state = getState();
  const entry = currentEntry(state);
  if (!entry.verifier) return;
  for (const event of entry.verifier.push(reading)) {
    handle(state, entry.quest.playerId, event);
  }
}
