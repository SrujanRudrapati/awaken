/**
 * Calibration (~5 min onboarding): Body → Vitality → Mind → Focus, any order.
 *
 *   body / vitality  60 s measurement vow (kind 'calibration', no Proof): the sensor verifiers
 *                    count reps exactly like a normal vow; the window closes on a server timer
 *   mind             2-min adaptive quiz (mind.ts), graded in code
 *   focus            60 s go/no-go (focus.ts): server schedule, client reaction times, code score
 *
 * When all four are scored: norms → starting rank (≤ C) + starting stats, baselines stored
 * (memory + Tiger `calibrations`). Re-calibration is allowed every 30 days (any time in
 * DEMO_MODE) and pays bonus Proof; it never lowers rank or stats. SSE: calibration.stage,
 * calibration.complete.
 */
import { publish } from '../../lib/bus';
import * as db from '../../lib/db';
import type { Player, QuestType, Rank } from '../../lib/schemas';
import { composeLine, sayLine } from '../agents/voice';
import { RANK_THRESHOLDS } from '../progression';
import { QuestError, applyCalibration, cancelQuest, getPlayer, getQuest, grantProof, isDemoMode, startQuest } from '../quests';
import { recentNights } from '../sleepSync';
import { FOCUS_DURATION_MS, buildTrials, scoreTrials, type Trial, type TrialResponse } from './focus';
import { MAX_MIND_QUESTIONS, MIND_DURATION_MS, adapt, generatePool, nextQuestion, publicQuestion, type Level, type MindQuestion } from './mind';
import {
  ageGroup, bodyScore, focusScore, mindScore, overallScore, startingRank, startingStats, vitalityScore,
  type AgeGroup, type BodyVariant, type MindAnswer, type StageScores,
} from './norms';

export const STAGES = ['body', 'vitality', 'mind', 'focus'] as const;
export type Stage = (typeof STAGES)[number];

export const SENSOR_WINDOW_MS = 60_000;
export const RECALIBRATION_DAYS = 30;
export const RECALIBRATION_BONUS = 50;
const SESSION_TTL_MS = 30 * 60_000;
/** Extra time to submit Focus results / a last Mind answer after the clock runs out. */
const SUBMIT_GRACE_MS = 30_000;
const MEASURE_TARGET = 9_999; // never reached: the window, not the target, ends a measurement
const DAY_MS = 24 * 60 * 60_000;

const BODY_TYPE: Record<BodyVariant, QuestType> = { pushup: 'pushup', wallpushup: 'pushup', chairsquat: 'squat' };
const BODY_LABEL: Record<BodyVariant, string> = { pushup: 'push-ups', wallpushup: 'wall push-ups', chairsquat: 'chair squats' };

interface SensorStage {
  questId: string;
  endsAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  playerId: string;
  startedAt: number;
  age?: number;
  bodyVariant: BodyVariant;
  includeHealth: boolean;
  recalibration: boolean;
  scores: Partial<StageScores>;
  baselines: Record<string, unknown>;
  sensor: Partial<Record<'body' | 'vitality', SensorStage>>;
  mind?: { pool: MindQuestion[]; asked: Set<string>; current: MindQuestion | null; level: Level; answers: MindAnswer[]; endsAt: number; timer: ReturnType<typeof setTimeout> };
  focus?: { trials: Trial[]; endsAt: number };
  result?: CalibrationResult;
}

export interface CalibrationResult {
  playerId: string;
  at: string;
  age: number | null;
  ageGroup: AgeGroup;
  bodyVariant: BodyVariant;
  scores: StageScores;
  overall: number;
  rank: Rank;
  stats: Player['stats'];
  baselines: Record<string, unknown>;
  recalibration: boolean;
  bonusXp: number;
}

export interface StartOptions {
  age?: number;
  bodyVariant?: BodyVariant;
  includeHealth?: boolean;
}

const globalForCalibration = globalThis as typeof globalThis & {
  __awakenCalibration?: { sessions: Map<string, Session>; latest: Map<string, CalibrationResult> };
};
function state() {
  globalForCalibration.__awakenCalibration ??= { sessions: new Map(), latest: new Map() };
  return globalForCalibration.__awakenCalibration;
}

// ── Views ───────────────────────────────────────────────────────────────────

export interface SessionView {
  playerId: string;
  startedAt: string;
  bodyVariant: BodyVariant;
  includeHealth: boolean;
  recalibration: boolean;
  stages: Record<Stage, { status: 'pending' | 'running' | 'done'; score?: number; endsAt?: string }>;
  result: CalibrationResult | null;
}

function stageStatus(session: Session, stage: Stage): SessionView['stages'][Stage] {
  const score = session.scores[stage];
  if (score !== undefined) return { status: 'done', score };
  const endsAt = stage === 'body' || stage === 'vitality' ? session.sensor[stage]?.endsAt : stage === 'mind' ? session.mind?.endsAt : session.focus?.endsAt;
  return endsAt ? { status: 'running', endsAt: new Date(endsAt).toISOString() } : { status: 'pending' };
}

export function viewOf(session: Session): SessionView {
  return {
    playerId: session.playerId,
    startedAt: new Date(session.startedAt).toISOString(),
    bodyVariant: session.bodyVariant,
    includeHealth: session.includeHealth,
    recalibration: session.recalibration,
    stages: Object.fromEntries(STAGES.map((s) => [s, stageStatus(session, s)])) as SessionView['stages'],
    result: session.result ?? null,
  };
}

// ── Start ───────────────────────────────────────────────────────────────────

async function latestResult(playerId: string): Promise<{ at: Date } | null> {
  const memory = state().latest.get(playerId);
  if (memory) return { at: new Date(memory.at) };
  try {
    return await db.latestCalibration(playerId);
  } catch {
    return null; // no database / no table: treat as first Calibration
  }
}

export async function startCalibration(playerId: string, options: StartOptions = {}, now = Date.now()): Promise<SessionView> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  const existing = state().sessions.get(playerId);
  if (existing && !existing.result && now - existing.startedAt < SESSION_TTL_MS) return viewOf(existing);

  const previous = await latestResult(playerId);
  if (previous && now - previous.at.getTime() < RECALIBRATION_DAYS * DAY_MS && !isDemoMode()) {
    const next = new Date(previous.at.getTime() + RECALIBRATION_DAYS * DAY_MS).toISOString().slice(0, 10);
    throw new QuestError(`Calibration was done recently. Next Calibration from ${next}.`, 409);
  }
  const session: Session = {
    playerId,
    startedAt: now,
    age: options.age,
    bodyVariant: options.bodyVariant ?? 'pushup',
    includeHealth: options.includeHealth ?? false,
    recalibration: previous !== null,
    scores: {},
    baselines: {},
    sensor: {},
  };
  state().sessions.set(playerId, session);
  return viewOf(session);
}

function requireSession(playerId: string): Session {
  const session = state().sessions.get(playerId);
  if (!session) throw new QuestError('Start Calibration first', 409);
  if (session.result) throw new QuestError('Calibration is already complete', 409);
  return session;
}

function requireNotScored(session: Session, stage: Stage): void {
  if (session.scores[stage] !== undefined) throw new QuestError(`The ${stage} stage is already scored`, 409);
}

function announceStage(playerId: string, stage: Stage, status: 'started' | 'done', extra: { score?: number; detail?: string; endsAt?: number } = {}): void {
  publish({
    type: 'calibration.stage',
    playerId,
    stage,
    status,
    ...(extra.score !== undefined ? { score: extra.score } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.endsAt ? { endsAt: new Date(extra.endsAt).toISOString() } : {}),
  });
}

// ── Body / Vitality (sensor windows) ────────────────────────────────────────

async function beginSensorStage(session: Session, stage: 'body' | 'vitality', now: number): Promise<{ questId: string; endsAt: string }> {
  requireNotScored(session, stage);
  const running = session.sensor[stage];
  if (running) return { questId: running.questId, endsAt: new Date(running.endsAt).toISOString() };
  const type: QuestType = stage === 'body' ? BODY_TYPE[session.bodyVariant] : 'jumpingjack';
  const label = stage === 'body' ? `Max ${BODY_LABEL[session.bodyVariant]} in 60 s` : 'Jumping jacks for 60 s';
  const quest = await startQuest(session.playerId, {
    type,
    kind: 'calibration',
    target: MEASURE_TARGET,
    title: `[CALIBRATION] ${label}`,
    deadline: new Date(now + SENSOR_WINDOW_MS + SUBMIT_GRACE_MS),
  });
  const endsAt = now + SENSOR_WINDOW_MS;
  const timer = setTimeout(() => {
    finishSensorStage(session, stage).catch((error: unknown) =>
      console.error(`[calibration] ${stage} finish failed:`, error instanceof Error ? error.message : error),
    );
  }, SENSOR_WINDOW_MS);
  session.sensor[stage] = { questId: quest.id, endsAt, timer };
  announceStage(session.playerId, stage, 'started', { detail: label, endsAt });
  return { questId: quest.id, endsAt: new Date(endsAt).toISOString() };
}

async function healthAverages(playerId: string): Promise<{ avgSteps: number | null; avgSleepHours: number | null }> {
  const [avgSteps, nights] = await Promise.all([
    Promise.resolve()
      .then(() => db.dailyAverage(playerId, 'health.steps', 7))
      .catch(() => null),
    recentNights(playerId, 7).catch(() => []),
  ]);
  const avgSleepHours = nights.length ? nights.reduce((sum, n) => sum + n.asleepMinutes, 0) / nights.length / 60 : null;
  return { avgSteps: avgSteps === null ? null : Math.round(avgSteps), avgSleepHours: avgSleepHours === null ? null : Math.round(avgSleepHours * 10) / 10 };
}

/** Closes a measurement window: reps from the sensors (never from the client). Idempotent. */
export async function finishSensorStage(session: Session, stage: 'body' | 'vitality'): Promise<number | undefined> {
  const running = session.sensor[stage];
  if (!running || session.scores[stage] !== undefined) return session.scores[stage];
  clearTimeout(running.timer);
  const quest = getQuest(running.questId);
  const reps = Math.floor(quest?.progress ?? 0);
  if (quest?.status === 'active') cancelQuest(session.playerId, quest.id);

  if (stage === 'body') {
    session.scores.body = bodyScore(reps, session.bodyVariant, session.age);
    session.baselines.body = { variant: session.bodyVariant, reps };
    announceStage(session.playerId, 'body', 'done', { score: session.scores.body, detail: `${reps} ${BODY_LABEL[session.bodyVariant]}` });
  } else {
    const health = session.includeHealth ? await healthAverages(session.playerId) : { avgSteps: null, avgSleepHours: null };
    session.scores.vitality = vitalityScore({ jumpingJacks: reps, ...health }, session.age);
    session.baselines.vitality = { jumpingJacks: reps, ...health };
    announceStage(session.playerId, 'vitality', 'done', { score: session.scores.vitality, detail: `${reps} jumping jacks` });
  }
  await maybeComplete(session);
  return session.scores[stage];
}

// ── Mind ────────────────────────────────────────────────────────────────────

function finishMind(session: Session): number {
  const mind = session.mind;
  if (!mind || session.scores.mind !== undefined) return session.scores.mind ?? 0;
  clearTimeout(mind.timer);
  session.scores.mind = mindScore(mind.answers);
  session.baselines.mind = { score: session.scores.mind, answered: mind.answers.length, correct: mind.answers.filter((a) => a.correct).length };
  announceStage(session.playerId, 'mind', 'done', { score: session.scores.mind, detail: `${mind.answers.filter((a) => a.correct).length}/${mind.answers.length} correct` });
  return session.scores.mind;
}

async function beginMind(session: Session, now: number) {
  requireNotScored(session, 'mind');
  if (!session.mind) {
    const pool = await generatePool();
    const endsAt = now + MIND_DURATION_MS;
    const timer = setTimeout(() => {
      finishMind(session);
      void maybeComplete(session);
    }, MIND_DURATION_MS + SUBMIT_GRACE_MS);
    session.mind = { pool, asked: new Set(), current: null, level: 2, answers: [], endsAt, timer };
    session.mind.current = nextQuestion(pool, session.mind.asked, 2);
    if (session.mind.current) session.mind.asked.add(session.mind.current.id);
    announceStage(session.playerId, 'mind', 'started', { detail: '2-minute adaptive quiz', endsAt });
  }
  return { endsAt: new Date(session.mind.endsAt).toISOString(), question: session.mind.current ? publicQuestion(session.mind.current) : null };
}

async function answerMind(session: Session, questionId: string, answerIndex: number, now: number) {
  const mind = session.mind;
  if (!mind) throw new QuestError('Begin the mind stage first', 409);
  requireNotScored(session, 'mind');
  if (!mind.current || mind.current.id !== questionId) throw new QuestError('That is not the current question', 409);

  const correct = mind.current.answerIndex === answerIndex;
  const inTime = now <= mind.endsAt + SUBMIT_GRACE_MS;
  if (inTime) mind.answers.push({ level: mind.current.level, correct });
  mind.level = adapt(mind.level, correct);
  const outOfTime = now >= mind.endsAt;
  const next = outOfTime || mind.answers.length >= MAX_MIND_QUESTIONS ? null : nextQuestion(mind.pool, mind.asked, mind.level);
  mind.current = next;
  if (next) mind.asked.add(next.id);
  const score = next ? undefined : finishMind(session);
  if (!next) await maybeComplete(session);
  return { correct, next: next ? publicQuestion(next) : null, done: !next, ...(score !== undefined ? { score } : {}) };
}

// ── Focus ───────────────────────────────────────────────────────────────────

function beginFocus(session: Session, now: number) {
  requireNotScored(session, 'focus');
  session.focus ??= { trials: buildTrials(), endsAt: now + FOCUS_DURATION_MS };
  announceStage(session.playerId, 'focus', 'started', { detail: '60 s go/no-go', endsAt: session.focus.endsAt });
  return { durationMs: FOCUS_DURATION_MS, trials: session.focus.trials, endsAt: new Date(session.focus.endsAt).toISOString() };
}

async function submitFocus(session: Session, responses: readonly TrialResponse[], now: number) {
  const focus = session.focus;
  if (!focus) throw new QuestError('Begin the focus stage first', 409);
  requireNotScored(session, 'focus');
  if (now > focus.endsAt + SUBMIT_GRACE_MS) throw new QuestError('Focus results arrived too late — begin the stage again', 409);
  const result = scoreTrials(focus.trials, responses);
  session.scores.focus = focusScore(result, session.age);
  const go = result.hits + result.misses;
  const nogo = result.falseAlarms + result.correctRejections;
  const accuracy = Math.round((((go ? result.hits / go : 0) + (nogo ? result.correctRejections / nogo : 1)) / 2) * 100) / 100;
  session.baselines.focus = { ...result, accuracy };
  announceStage(session.playerId, 'focus', 'done', { score: session.scores.focus, detail: `${result.meanRtMs ?? '—'} ms, ${Math.round(accuracy * 100)}% accurate` });
  await maybeComplete(session);
  return { score: session.scores.focus, ...result, accuracy };
}

// ── Completion ──────────────────────────────────────────────────────────────

const rankXp = (rank: Rank): number => RANK_THRESHOLDS.find(([r]) => r === rank)?.[1] ?? 0;

async function maybeComplete(session: Session): Promise<void> {
  if (session.result || !STAGES.every((s) => session.scores[s] !== undefined)) return;
  const scores = session.scores as StageScores;
  const rank = startingRank(scores);
  const stats = startingStats(scores);
  const bonusXp = session.recalibration ? RECALIBRATION_BONUS : 0;
  const at = new Date();
  const result: CalibrationResult = {
    playerId: session.playerId,
    at: at.toISOString(),
    age: session.age ?? null,
    ageGroup: ageGroup(session.age),
    bodyVariant: session.bodyVariant,
    scores,
    overall: overallScore(scores),
    rank,
    stats,
    baselines: session.baselines,
    recalibration: session.recalibration,
    bonusXp,
  };
  session.result = result;
  state().latest.set(session.playerId, result);

  await applyCalibration(session.playerId, { stats, xp: session.recalibration ? 0 : rankXp(rank) });
  if (bonusXp) await grantProof(session.playerId, bonusXp, 'recalibration');
  Promise.resolve()
    .then(() => db.insertCalibration(session.playerId, at, { ...result }))
    .catch((error: unknown) =>
    console.error('[calibration] persist failed:', error instanceof Error ? error.message : error),
  );
  db.logEvent({ playerId: session.playerId, kind: 'calibration', value: result.overall, source: 'engine', detail: { rank, scores } });
  publish({ type: 'calibration.complete', playerId: session.playerId, rank, overall: result.overall, scores, recalibration: session.recalibration, bonusXp });

  const moment = {
    type: 'awakening' as const,
    playerId: session.playerId,
    facts: `Calibration complete. Starting rank ${rank}. Body ${scores.body}, Vitality ${scores.vitality}, Mind ${scores.mind}, Focus ${scores.focus} out of 100.${session.recalibration ? ` Re-calibration bonus: ${bonusXp} Proof.` : ''}`,
  };
  await sayLine(moment, await composeLine(moment));
}

// ── Submit (dispatch) ───────────────────────────────────────────────────────

export type SubmitInput =
  | { stage: 'body' | 'vitality'; action: 'begin' | 'finish' }
  | { stage: 'mind'; action: 'begin' }
  | { stage: 'mind'; action: 'answer'; questionId: string; answerIndex: number }
  | { stage: 'focus'; action: 'begin' }
  | { stage: 'focus'; action: 'submit'; responses: TrialResponse[] };

export async function submitCalibration(playerId: string, input: SubmitInput, now = Date.now()): Promise<{ session: SessionView; stage: unknown }> {
  const session = requireSession(playerId);
  let stage: unknown;
  if (input.stage === 'body' || input.stage === 'vitality') {
    if (input.action === 'begin') stage = await beginSensorStage(session, input.stage, now);
    else {
      const running = session.sensor[input.stage];
      if (!running) throw new QuestError(`Begin the ${input.stage} stage first`, 409);
      if (now < running.endsAt && !isDemoMode()) throw new QuestError('The 60 s window is still open', 409);
      stage = { score: await finishSensorStage(session, input.stage) };
    }
  } else if (input.stage === 'mind') {
    stage = input.action === 'begin' ? await beginMind(session, now) : await answerMind(session, input.questionId, input.answerIndex, now);
  } else if (input.action === 'begin') {
    stage = beginFocus(session, now);
  } else if (input.action === 'submit') {
    stage = await submitFocus(session, input.responses, now);
  }
  return { session: viewOf(session), stage };
}

/** Latest stored result (memory, then Tiger). Used by rank/Proof scaling. */
export async function calibrationFor(playerId: string): Promise<CalibrationResult | null> {
  const memory = state().latest.get(playerId);
  if (memory) return memory;
  const stored = await db.latestCalibration(playerId).catch(() => null);
  return stored ? (stored.result as unknown as CalibrationResult) : null;
}

/** Test hook. */
export function resetCalibration(): void {
  const s = globalForCalibration.__awakenCalibration;
  s?.sessions.forEach((session) => {
    Object.values(session.sensor).forEach((stage) => stage && clearTimeout(stage.timer));
    if (session.mind) clearTimeout(session.mind.timer);
  });
  globalForCalibration.__awakenCalibration = undefined;
}
