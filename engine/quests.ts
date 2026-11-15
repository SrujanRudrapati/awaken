/**
 * Quest engine: players, quests, XP, level-ups, penalties, emergency and daily quests.
 *
 * - Deterministic: sensor quests complete only when the router's verifiers say so
 *   (setCompletionHandler); health/quiz/photo/gate quests complete via their own APIs.
 * - State is in memory on globalThis (survives hot reload); players write through to
 *   Tiger Data best-effort, so the demo keeps working with the DB offline.
 * - Every state change is published on the bus for the UI and mirrored to the Home Base.
 */
import { randomUUID } from 'node:crypto';
import { publish } from '../lib/bus';
import * as db from '../lib/db';
import { send, sendAll } from '../lib/device';
import { notify } from '../lib/notify';
import { StatSchema, type Difficulty, type Player, type Quest, type QuestKind, type QuestType } from '../lib/schemas';
import {
  DAILY_TEMPLATES,
  HARDER,
  QUEST_RULES,
  defaultTitle,
  endOfDay,
  demoRankUpXp,
  levelForXp,
  rankForXp,
  rankSegment,
  segNumber,
  xpFor,
  type QuestTemplate,
} from './progression';
import {
  clearActiveQuest,
  getActiveQuest,
  hasSensorVerifier,
  setActiveQuest,
  setCompletionHandler,
  setFailureHandler,
} from './router';

export const EMERGENCY_TARGET = 10;
export const EMERGENCY_SECONDS = 30;
const LEVELUP_RANK_DELAY_MS = 2_000;
const COUNTDOWN_TICK_MS = 1_000;
/** Longest we wait on Tiger Data for a player lookup before treating it as unknown. */
const DB_LOOKUP_TIMEOUT_MS = 500;
/** DEMO_MODE: Phone Jail quests default to 20 s so the stage demo doesn't take 25 minutes. */
export const DEMO_JAIL_SECONDS = 20;
/** A failed hard / custom-target quest comes back this much bigger. */
const PENALTY_TARGET_FACTOR = 1.5;

/** Error with an HTTP status, so routes can map engine failures to responses. */
export class QuestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

interface EngineState {
  players: Map<string, Player>;
  quests: Map<string, Quest>;
  timers: Map<string, ReturnType<typeof setInterval>>;
}

const globalForEngine = globalThis as typeof globalThis & { __awakenEngine?: EngineState };

function getState(): EngineState {
  globalForEngine.__awakenEngine ??= { players: new Map(), quests: new Map(), timers: new Map() };
  return globalForEngine.__awakenEngine;
}

/** Test hook: forget players, quests and timers. */
export function resetEngine(): void {
  const state = globalForEngine.__awakenEngine;
  state?.timers.forEach((timer) => clearInterval(timer));
  globalForEngine.__awakenEngine = undefined;
  registerWithRouter();
}

// ── Players ─────────────────────────────────────────────────────────────────

function zeroStats(): Player['stats'] {
  return Object.fromEntries(StatSchema.options.map((s) => [s, 0])) as Player['stats'];
}

function savePlayer(player: Player): Player {
  getState().players.set(player.id, player);
  db.upsertPlayer(player).catch((error: unknown) =>
    console.error(`[engine] could not persist player ${player.id}:`, error instanceof Error ? error.message : error),
  );
  return player;
}

/** The in-memory copy, which is always the freshest (DB writes are fire-and-forget). */
function cachedPlayer(id: string): Player | undefined {
  return getState().players.get(id);
}

async function lookupStoredPlayer(id: string): Promise<Player | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DB_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([db.getPlayer(id).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Memory first, then Tiger Data (cached; gives up after DB_LOOKUP_TIMEOUT_MS). Null if unknown. */
export async function getPlayer(id: string): Promise<Player | null> {
  const cached = cachedPlayer(id);
  if (cached) return cached;
  const stored = await lookupStoredPlayer(id);
  if (!stored) return null;
  // Another call may have created/updated the player while we waited — memory wins.
  const raced = cachedPlayer(id);
  if (raced) return raced;
  getState().players.set(id, stored);
  return stored;
}

/** Resolves the player, then returns the freshest in-memory copy (avoids lost updates across awaits). */
async function requirePlayer(id: string): Promise<Player> {
  const player = await getPlayer(id);
  if (!player) throw new QuestError(`No player ${id}`, 404);
  return cachedPlayer(id) ?? player;
}

/** Creates a player, or returns the existing one with that id. */
export async function createPlayer(input: { name: string; id?: string }): Promise<Player> {
  if (input.id) {
    const existing = await getPlayer(input.id);
    if (existing) return existing;
  }
  const id = input.id ?? randomUUID();
  return savePlayer({ id, name: input.name, rank: 'E', level: 1, xp: 0, stats: zeroStats(), penalty: false });
}

/**
 * Forgets in-memory players matching `shouldPurge`, with their quests, countdowns and
 * sensor focus (no events published: the players are gone). Returns how many were removed.
 */
export function purgePlayers(shouldPurge: (playerId: string) => boolean): number {
  const state = getState();
  for (const quest of [...state.quests.values()]) {
    if (!shouldPurge(quest.playerId)) continue;
    stopQuest(quest);
    state.quests.delete(quest.id);
  }
  const ids = [...state.players.keys()].filter(shouldPurge);
  ids.forEach((id) => {
    clearActiveQuest(id);
    state.players.delete(id);
  });
  return ids.length;
}

/** Players the engine holds in memory (fresher than Tiger Data). */
export function listPlayersInMemory(): Player[] {
  return [...getState().players.values()];
}

// ── Quests ──────────────────────────────────────────────────────────────────

function storeQuest(quest: Quest): Quest {
  getState().quests.set(quest.id, quest);
  return quest;
}

/** The quest as the engine knows it, with live progress from the router if it is counting. */
function withLiveProgress(quest: Quest): Quest {
  const live = getActiveQuest(quest.playerId);
  return live?.id === quest.id ? { ...quest, progress: live.progress } : quest;
}

export function getQuest(questId: string): Quest | undefined {
  const quest = getState().quests.get(questId);
  return quest ? withLiveProgress(quest) : undefined;
}

/** All of a player's quests, active first, newest first. */
export function listQuests(playerId: string): Quest[] {
  const order: Record<Quest['status'], number> = { active: 0, done: 1, failed: 2, cancelled: 3 };
  return [...getState().quests.values()]
    .filter((q) => q.playerId === playerId)
    .map(withLiveProgress)
    .sort((a, b) => order[a.status] - order[b.status] || b.deadline.localeCompare(a.deadline));
}

function requireActiveQuest(playerId: string, questId: string): Quest {
  const quest = getQuest(questId);
  if (!quest || quest.playerId !== playerId) throw new QuestError(`No quest ${questId} for ${playerId}`, 404);
  if (quest.status !== 'active') throw new QuestError(`Quest ${questId} is already ${quest.status}`, 409);
  return quest;
}

function isExpired(quest: Quest, now = new Date()): boolean {
  return new Date(quest.deadline) < now;
}

export interface NewQuestInput {
  type: QuestType;
  difficulty?: Difficulty;
  target?: number;
  title?: string;
  deadline?: Date;
  kind?: QuestKind;
}

function buildQuest(playerId: string, input: NewQuestInput): Quest {
  const difficulty = input.difficulty ?? 'normal';
  const demoJail = isDemoMode() && input.type === 'jail' ? DEMO_JAIL_SECONDS : undefined;
  const target = input.target ?? demoJail ?? QUEST_RULES[input.type].target[difficulty];
  return {
    id: randomUUID(),
    playerId,
    stat: QUEST_RULES[input.type].stat,
    title: input.title ?? defaultTitle(input.type, target),
    type: input.type,
    target,
    progress: 0,
    xp: xpFor(input.type, difficulty),
    status: 'active',
    deadline: (input.deadline ?? endOfDay(new Date())).toISOString(),
    difficulty,
    kind: input.kind ?? 'manual',
  };
}

function stopQuest(quest: Quest): void {
  if (getActiveQuest(quest.playerId)?.id === quest.id) clearActiveQuest(quest.playerId);
  const timer = getState().timers.get(quest.id);
  if (timer) clearInterval(timer);
  getState().timers.delete(quest.id);
}

/**
 * Cancels running emergency quests other than `keepId` (one Home Base = one countdown).
 * Cancelled, not failed: the player chose to switch, so no alarm and no penalty.
 */
function cancelOtherEmergencies(keepId: string): void {
  for (const questId of getState().timers.keys()) {
    const quest = getState().quests.get(questId);
    if (!quest || quest.id === keepId || quest.status !== 'active') continue;
    stopQuest(quest);
    const cancelled = storeQuest({ ...withLiveProgress(quest), status: 'cancelled' });
    publish({ type: 'quest.update', quest: cancelled });
  }
}

/** Points the sensors at `quest`, saving the progress of whatever quest they were counting. */
function activate(quest: Quest): void {
  if (!hasSensorVerifier(quest.type)) return; // health / quiz / photo / gate quests don't use sensors
  cancelOtherEmergencies(quest.id);
  const running = getActiveQuest(quest.playerId);
  if (running && running.id !== quest.id) {
    const paused = getState().quests.get(running.id);
    if (paused?.status === 'active') storeQuest({ ...paused, progress: running.progress });
  }
  // Always re-focus: another player may have used the Home Base since this quest was set.
  const progress = running?.id === quest.id ? running.progress : quest.progress;
  setActiveQuest({ ...quest, progress });
  void send(segNumber(progress));
}

/** An active, unexpired quest of this type the player can pick back up instead of duplicating it. */
function findResumable(playerId: string, type: QuestType): Quest | undefined {
  return listQuests(playerId).find(
    (q) => q.status === 'active' && q.type === type && q.kind !== 'emergency' && !isExpired(q),
  );
}

function launch(quest: Quest): Quest {
  activate(quest);
  const current = getQuest(quest.id) ?? quest;
  publish({ type: 'quest.update', quest: current });
  return current;
}

/**
 * Starts a quest: with questId, resumes that active quest; with a type, resumes the
 * player's active quest of that type if there is one, otherwise creates a new one.
 */
export async function startQuest(playerId: string, input: NewQuestInput | { questId: string }): Promise<Quest> {
  await requirePlayer(playerId);
  if ('questId' in input) {
    const quest = requireActiveQuest(playerId, input.questId);
    if (isExpired(quest) && !getState().timers.has(quest.id)) {
      throw new QuestError(`Quest ${quest.id} is past its deadline`, 409);
    }
    return launch(quest);
  }
  const existing = input.kind === undefined ? findResumable(playerId, input.type) : undefined;
  return launch(existing ?? storeQuest(buildQuest(playerId, input)));
}

// ── Completion, level-up, failure ───────────────────────────────────────────

export interface CompletionResult {
  quest: Quest;
  player: Player;
  leveledUp: boolean;
}

/** Awards XP (+1 stat) for an active quest. Internal: sensor quests reach this only via the router. */
async function awardQuest(playerId: string, questId: string): Promise<CompletionResult> {
  await requirePlayer(playerId);
  const active = requireActiveQuest(playerId, questId);
  const player = cachedPlayer(playerId) as Player; // re-read after the await: no lost updates
  stopQuest(active);
  const quest = storeQuest({ ...active, status: 'done', progress: Math.max(active.progress, active.target) });

  const xp = player.xp + quest.xp;
  const penaltyCleared = quest.kind === 'penalty' && !hasActivePenaltyQuest(playerId);
  const updated = savePlayer({
    ...player,
    xp,
    level: levelForXp(xp),
    rank: rankForXp(xp),
    stats: { ...player.stats, [quest.stat]: player.stats[quest.stat] + 1 },
    penalty: penaltyCleared ? false : player.penalty,
  });

  db.logEvent({ playerId, kind: 'xp', stat: quest.stat, value: quest.xp, source: 'engine' });
  db.logEvent({ playerId, kind: 'quest.complete', stat: quest.stat, value: 1, source: 'engine' });
  publish({ type: 'quest.complete', quest, xpGained: quest.xp });
  notify({ title: '[QUEST COMPLETE]', message: `${quest.title} · +${quest.xp} XP`, tags: ['white_check_mark'] });

  const leveledUp = updated.level > player.level;
  if (leveledUp) announceLevelUp(player, updated);
  else void sendAll(['BUZZ:chime', segNumber(quest.progress)]);
  return { quest, player: updated, leveledUp };
}

/**
 * Records partial progress on a non-sensor quest (e.g. 5 200 of 8 000 steps). Never lowers it.
 * Sensor quests are refused, like completeQuest.
 */
export async function setQuestProgress(playerId: string, questId: string, progress: number): Promise<Quest> {
  await requirePlayer(playerId);
  const active = requireActiveQuest(playerId, questId);
  if (hasSensorVerifier(active.type)) {
    throw new QuestError(`Quest ${questId} is a sensor quest; only the sensors can count it`, 409);
  }
  if (progress <= active.progress) return active;
  const quest = storeQuest({ ...active, progress: Math.min(progress, active.target) });
  publish({ type: 'quest.update', quest });
  return quest;
}

/**
 * Completes a non-sensor quest (health / quiz / photo / gate) once its own verifier passed.
 * Sensor quests are refused: only the router's deterministic verifiers may complete them.
 */
export async function completeQuest(playerId: string, questId: string): Promise<CompletionResult> {
  const quest = getQuest(questId);
  if (quest && hasSensorVerifier(quest.type)) {
    throw new QuestError(`Quest ${questId} is a sensor quest; only the sensors can complete it`, 409);
  }
  return awardQuest(playerId, questId);
}

function hasActivePenaltyQuest(playerId: string): boolean {
  return listQuests(playerId).some((q) => q.status === 'active' && q.kind === 'penalty');
}

function announceLevelUp(before: Player, after: Player): void {
  publish({ type: 'levelup', playerId: after.id, fromRank: before.rank, toRank: after.rank, level: after.level });
  db.logEvent({ playerId: after.id, kind: 'levelup', value: after.level, source: 'engine' });
  void sendAll(['BUZZ:chime', 'SEG:LVUP']);
  notify({
    title: '[LEVEL UP]',
    message: `${after.name} reached level ${after.level} · Rank ${after.rank}`,
    priority: 'high',
    tags: ['zap'],
  });
  setTimeout(() => {
    if (getState().timers.size > 0) return; // a countdown owns the display now
    void send(rankSegment(after.rank));
  }, LEVELUP_RANK_DELAY_MS);
}

/** The retry for a failed quest: one difficulty up, or 1.5× the target if it was already hard/custom. */
function buildPenaltyQuest(failed: Quest): Quest {
  const difficulty = failed.difficulty ?? 'normal';
  const isDefaultTarget = failed.target === QUEST_RULES[failed.type].target[difficulty];
  const canStepUp = HARDER[difficulty] !== difficulty;
  return buildQuest(failed.playerId, {
    type: failed.type,
    difficulty: HARDER[difficulty],
    target: isDefaultTarget && canStepUp ? undefined : Math.ceil(failed.target * PENALTY_TARGET_FACTOR),
    kind: 'penalty',
    title: `[PENALTY] ${QUEST_RULES[failed.type].title}`,
  });
}

export interface FailureResult {
  quest: Quest;
  penaltyQuest: Quest | null;
}

export interface FailOptions {
  /** Skip the alarm + FAIL display (the caller batches one alarm for many failures). */
  quiet?: boolean;
  /** Issue a harder retry quest (default true). */
  spawnPenalty?: boolean;
}

/** Fails an active quest: Penalty Zone + (by default) a harder retry quest. */
export async function failQuest(
  playerId: string,
  questId: string,
  reason: string,
  options: FailOptions = {},
): Promise<FailureResult> {
  await requirePlayer(playerId);
  const active = requireActiveQuest(playerId, questId);
  const player = cachedPlayer(playerId) as Player; // re-read after the await: no lost updates
  stopQuest(active);
  const quest = storeQuest({ ...active, status: 'failed' });
  savePlayer({ ...player, penalty: true });

  db.logEvent({ playerId, kind: 'penalty', stat: quest.stat, value: 1, verified: true, source: 'engine' });
  publish({ type: 'quest.update', quest });
  publish({ type: 'penalty', playerId, questId, reason });
  if (!options.quiet) {
    void sendAll(['BUZZ:alarm', 'SEG:FAIL']);
    notify({ title: '[PENALTY ZONE]', message: reason, priority: 'urgent', tags: ['warning'] });
  }

  if (options.spawnPenalty === false) return { quest, penaltyQuest: null };
  const penaltyQuest = storeQuest(buildPenaltyQuest(quest));
  publish({ type: 'quest.update', quest: penaltyQuest });
  return { quest, penaltyQuest };
}

/** Router hook: a sensor quest hit its target. */
function onSensorComplete(quest: Quest): void {
  if (!getState().quests.has(quest.id)) {
    publish({ type: 'quest.complete', quest, xpGained: quest.xp }); // not an engine quest
    return;
  }
  awardQuest(quest.playerId, quest.id)
    .then(() => {
      if (quest.type === 'jail') issueFocusQuiz(quest.playerId);
    })
    .catch((error: unknown) => {
      console.error(`[engine] completing ${quest.id} failed:`, error instanceof Error ? error.message : error);
      // Keep the reps: a resume (POST /api/quest/start {questId}) can still finish it.
      const stored = getState().quests.get(quest.id);
      if (stored?.status !== 'active') return;
      const kept = storeQuest({ ...stored, progress: quest.progress });
      publish({ type: 'quest.update', quest: kept });
    });
}

/** After a Phone Jail session: a quiz quest proves the focus was real (Phase 9 quiz agent grades it). */
function issueFocusQuiz(playerId: string): void {
  const quiz = storeQuest(buildQuest(playerId, { type: 'quiz', title: '[FOCUS QUIZ] Prove what you studied', kind: 'manual' }));
  publish({ type: 'quest.update', quest: quiz });
}

/** Router hook: a timer verifier failed its quest (e.g. phone pulled from the jail early). */
function onSensorFail(quest: Quest, reason: string): void {
  if (!getState().quests.has(quest.id)) return; // not an engine quest
  failQuest(quest.playerId, quest.id, reason).catch((error: unknown) => {
    console.error(`[engine] failing ${quest.id} failed:`, error instanceof Error ? error.message : error);
  });
}

function registerWithRouter(): void {
  setCompletionHandler(onSensorComplete);
  setFailureHandler(onSensorFail);
}
registerWithRouter();

// ── Emergency quest ─────────────────────────────────────────────────────────

function activeEmergency(playerId: string): Quest | undefined {
  return listQuests(playerId).find((q) => q.status === 'active' && q.kind === 'emergency' && getState().timers.has(q.id));
}

/** DEMO_MODE=1: a brand-new player's first emergency quest is worth a rank-up (stage demo). */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * 10 reps in 30 s, counting down on the Home Base display. Missing it = penalty. Idempotent while running.
 * In demo mode an E-rank player's first emergency pays enough XP to reach D.
 */
export async function emergencyQuest(playerId: string, type: QuestType = 'pushup'): Promise<Quest> {
  const player = await requirePlayer(playerId);
  const running = activeEmergency(playerId);
  if (running) return running;

  const brandNew = player.rank === 'E' && !listQuests(playerId).some((q) => q.kind === 'emergency');
  const deadline = new Date(Date.now() + EMERGENCY_SECONDS * 1_000);
  const built = buildQuest(playerId, {
    type,
    difficulty: 'hard',
    target: EMERGENCY_TARGET,
    title: `[EMERGENCY] ${EMERGENCY_TARGET} ${QUEST_RULES[type].title} in ${EMERGENCY_SECONDS} s`,
    deadline,
    kind: 'emergency',
  });
  const xp = isDemoMode() && brandNew ? Math.max(built.xp, demoRankUpXp(player.xp)) : built.xp;
  const quest = launch(storeQuest({ ...built, xp }));
  void sendAll(['BUZZ:alarm', segNumber(EMERGENCY_SECONDS)]);
  notify({ title: '[EMERGENCY QUEST]', message: quest.title, priority: 'urgent', tags: ['rotating_light'] });

  const timer = setInterval(() => {
    const secondsLeft = Math.ceil((deadline.getTime() - Date.now()) / 1_000);
    if (getQuest(quest.id)?.status !== 'active') {
      clearInterval(timer);
      getState().timers.delete(quest.id);
      return;
    }
    if (secondsLeft > 0) {
      void send(segNumber(secondsLeft));
      return;
    }
    clearInterval(timer);
    failQuest(playerId, quest.id, `Emergency quest failed: ${EMERGENCY_TARGET} reps not done in ${EMERGENCY_SECONDS} s`).catch(
      () => {}, // completed in the same instant — nothing to fail
    );
  }, COUNTDOWN_TICK_MS);
  getState().timers.set(quest.id, timer);
  return quest;
}

// ── Daily drop (cron) ───────────────────────────────────────────────────────

/** Supplies a player's daily quests (Gemini designer later); defaults to DAILY_TEMPLATES. */
export type QuestDesigner = (player: Player) => Promise<readonly QuestTemplate[]>;

const templateDesigner: QuestDesigner = async () => DAILY_TEMPLATES;

/**
 * Fails every active quest whose deadline has passed: quietly, then one alarm and one
 * penalty quest per player (missed penalty quests don't chain into more). Returns how many failed.
 */
export async function sweepExpired(now = new Date()): Promise<number> {
  const expired = [...getState().quests.values()].filter(
    (q) => q.status === 'active' && isExpired(q, now) && !getState().timers.has(q.id),
  );
  const failedByPlayer = new Map<string, Quest[]>();
  for (const quest of expired) {
    const result = await failQuest(quest.playerId, quest.id, `Missed deadline: ${quest.title}`, {
      quiet: true,
      spawnPenalty: false,
    }).catch(() => null);
    if (result) failedByPlayer.set(quest.playerId, [...(failedByPlayer.get(quest.playerId) ?? []), result.quest]);
  }
  for (const failed of failedByPlayer.values()) {
    notify({
      title: '[PENALTY ZONE]',
      message: `Missed: ${failed.map((q) => q.title).join(', ')}. A penalty quest has been issued.`,
      priority: 'urgent',
      tags: ['warning'],
    });
    const source = failed.find((q) => q.kind !== 'penalty') ?? failed[0];
    const penaltyQuest = storeQuest(buildPenaltyQuest(source));
    publish({ type: 'quest.update', quest: penaltyQuest });
  }
  if (failedByPlayer.size > 0) void sendAll(['BUZZ:alarm', 'SEG:FAIL']);
  return expired.length;
}

/**
 * Midnight drop for every known player: missed quests → Penalty Zone, then today's quests.
 * Skips a type the player already got a daily for today, whatever its status (safe to call twice).
 */
export async function dailyDrop(now = new Date(), design: QuestDesigner = templateDesigner): Promise<Record<string, Quest[]>> {
  await sweepExpired(now);
  const stored = await db.listPlayers().catch(() => []);
  stored.forEach((p) => {
    if (!getState().players.has(p.id)) getState().players.set(p.id, p);
  });

  const todayDeadline = endOfDay(now).toISOString();
  const dropped: Record<string, Quest[]> = {};
  for (const player of getState().players.values()) {
    const templates = await design(player).catch(() => DAILY_TEMPLATES);
    const droppedToday = new Set(
      listQuests(player.id)
        .filter((q) => q.kind === 'daily' && q.deadline === todayDeadline)
        .map((q) => q.type),
    );
    const quests = templates
      .filter((t) => !droppedToday.has(t.type))
      .map((t) => storeQuest(buildQuest(player.id, { ...t, kind: 'daily', deadline: endOfDay(now) })));
    quests.forEach((quest) => publish({ type: 'quest.update', quest }));
    dropped[player.id] = quests;
  }
  const titles = [...new Set(Object.values(dropped).flat().map((q) => q.title))];
  if (titles.length > 0) {
    notify({ title: '[DAILY QUEST HAS ARRIVED]', message: titles.join('\n'), priority: 'high', tags: ['scroll'] });
  }
  return dropped;
}
