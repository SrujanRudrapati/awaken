/**
 * Calibration scoring (pure). Each stage → 0–100 against age-group norms; the average sets
 * the starting rank (E/D/C — capped at C: higher ranks must be earned).
 *
 * Norm anchors are [low, typical, high] counts in 60 s for healthy adults by age group, taken
 * from common fitness-test tables (60 s push-up / sit-to-stand / jumping-jack norms) and
 * rounded. They map to scores 20 / 50 / 90, linearly between, clamped to 0–100.
 */
import type { Player, Rank } from '../../lib/schemas';

export type AgeGroup = 'u30' | '30s' | '40s' | '50s' | '60plus';
export type BodyVariant = 'pushup' | 'wallpushup' | 'chairsquat';
type Anchors = readonly [number, number, number];

const ANCHOR_SCORES: Anchors = [20, 50, 90];

export const BODY_NORMS: Record<BodyVariant, Record<AgeGroup, Anchors>> = {
  pushup: { u30: [12, 28, 50], '30s': [10, 22, 42], '40s': [8, 17, 35], '50s': [5, 13, 28], '60plus': [3, 10, 22] },
  wallpushup: { u30: [25, 45, 70], '30s': [22, 40, 64], '40s': [20, 36, 58], '50s': [16, 32, 52], '60plus': [12, 28, 46] },
  chairsquat: { u30: [20, 32, 45], '30s': [18, 30, 42], '40s': [16, 27, 38], '50s': [14, 24, 34], '60plus': [11, 20, 30] },
};

export const JUMPING_JACK_NORMS: Record<AgeGroup, Anchors> = {
  u30: [30, 50, 75], '30s': [27, 45, 68], '40s': [24, 40, 60], '50s': [20, 34, 52], '60plus': [15, 28, 44],
};

const STEPS_ANCHORS: Anchors = [4_000, 7_500, 11_000];

/** Unknown age → the 30s row (a middle adult norm). */
export function ageGroup(age: number | undefined): AgeGroup {
  if (age === undefined) return '30s';
  if (age < 30) return 'u30';
  if (age < 40) return '30s';
  if (age < 50) return '40s';
  if (age < 60) return '50s';
  return '60plus';
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Piecewise-linear: value at anchors → 20/50/90, extrapolated beyond, clamped 0–100. */
export function scoreAgainst(value: number, anchors: Anchors): number {
  const [a, b, c] = anchors;
  const [sa, sb, sc] = ANCHOR_SCORES;
  if (value <= a) return clamp((value / a) * sa);
  if (value <= b) return clamp(sa + ((value - a) / (b - a)) * (sb - sa));
  if (value <= c) return clamp(sb + ((value - b) / (c - b)) * (sc - sb));
  return clamp(sc + ((value - c) / (c - b)) * (sc - sb));
}

export function bodyScore(reps: number, variant: BodyVariant, age?: number): number {
  return scoreAgainst(reps, BODY_NORMS[variant][ageGroup(age)]);
}

/** Average hours asleep → 0–100 (7–9 h is best). */
export function sleepScore(hours: number): number {
  if (hours >= 7 && hours <= 9) return 90;
  if (hours > 9) return clamp(90 - (hours - 9) * 20);
  return clamp(90 - (7 - hours) * 27);
}

export interface VitalityInput {
  jumpingJacks: number;
  /** 7-day averages from Apple Health, when the person opted in. */
  avgSteps?: number | null;
  avgSleepHours?: number | null;
}

/** Jumping jacks, blended with Health steps (25 %) and sleep (15 %) when available. */
export function vitalityScore(input: VitalityInput, age?: number): number {
  const jacks = scoreAgainst(input.jumpingJacks, JUMPING_JACK_NORMS[ageGroup(age)]);
  const parts: [number, number][] = [[jacks, 0.6]];
  if (input.avgSteps != null) parts.push([scoreAgainst(input.avgSteps, STEPS_ANCHORS), 0.25]);
  if (input.avgSleepHours != null) parts.push([sleepScore(input.avgSleepHours), 0.15]);
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  return clamp(parts.reduce((sum, [score, w]) => sum + score * w, 0) / weight);
}

export interface MindAnswer {
  level: 1 | 2 | 3;
  correct: boolean;
}

/** Adaptive quiz: correct answers weighted by difficulty; fewer than 3 answered scales down. */
export function mindScore(answers: readonly MindAnswer[]): number {
  if (answers.length === 0) return 0;
  const points = answers.reduce((sum, a) => sum + (a.correct ? a.level : 0), 0);
  return clamp((100 * points) / (3 * Math.max(3, answers.length)));
}

export interface FocusResult {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  meanRtMs: number | null;
}

/** Fastest believable reaction; anything quicker was a guess. */
export const MIN_RT_MS = 120;
export const MAX_RT_MS = 1_000;
const FAST_RT_MS = 300;
const SLOW_RT_MS = 650;
/** Reaction-time allowance per decade over 30. */
const RT_PER_DECADE_MS = 15;

/** Go/no-go: 60 % accuracy (hits + correct rejections), 40 % speed (age-adjusted). */
export function focusScore(result: FocusResult, age?: number): number {
  const go = result.hits + result.misses;
  const nogo = result.falseAlarms + result.correctRejections;
  const accuracy = ((go ? result.hits / go : 0) + (nogo ? result.correctRejections / nogo : 1)) / 2;
  const allowance = age && age > 30 ? Math.floor((age - 30) / 10) * RT_PER_DECADE_MS : 0;
  const rt = result.meanRtMs === null ? SLOW_RT_MS : result.meanRtMs - allowance;
  const speed = Math.max(0, Math.min(1, (SLOW_RT_MS - rt) / (SLOW_RT_MS - FAST_RT_MS)));
  return clamp(100 * (0.6 * accuracy + 0.4 * speed));
}

export interface StageScores {
  body: number;
  vitality: number;
  mind: number;
  focus: number;
}

export const RANK_CUTOFFS: readonly (readonly [Rank, number])[] = [
  ['C', 70],
  ['D', 45],
  ['E', 0],
];

export function overallScore(scores: StageScores): number {
  return clamp((scores.body + scores.vitality + scores.mind + scores.focus) / 4);
}

/** Starting rank from Calibration — never above C. */
export function startingRank(scores: StageScores): Rank {
  const overall = overallScore(scores);
  return RANK_CUTOFFS.find(([, min]) => overall >= min)?.[0] ?? 'E';
}

/** Starting stat points (0–5 each) — Discipline and Presence start at 0. */
export function startingStats(scores: StageScores): Player['stats'] {
  const points = (score: number) => Math.round(score / 20);
  return { STR: points(scores.body), VIT: points(scores.vitality), INT: points(scores.mind), FOCUS: points(scores.focus), DISCIPLINE: 0, CHA: 0 };
}
