/**
 * Pure game rules: XP, ranks, levels, which stat a quest trains, default targets,
 * and the daily quest templates. No I/O — the quest engine applies these.
 */
import type { Difficulty, QuestType, Rank, Stat } from '../lib/schemas';

/** Minimum total XP for each rank (E0 D100 C300 B700 A1500); A is the top rank. */
export const RANK_THRESHOLDS: readonly (readonly [Rank, number])[] = [
  ['A', 1500],
  ['B', 700],
  ['C', 300],
  ['D', 100],
  ['E', 0],
];

export const XP_PER_LEVEL = 50;

/** XP still needed to reach the next rank (0 at A). Used by demo mode's guaranteed first rank-up. */
export function demoRankUpXp(xp: number): number {
  const next = [...RANK_THRESHOLDS].reverse().find(([, min]) => min > xp);
  return next ? next[1] - xp : 0;
}

export function rankForXp(xp: number): Rank {
  return RANK_THRESHOLDS.find(([, min]) => xp >= min)?.[0] ?? 'E';
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { easy: 1, normal: 1.5, hard: 2 };

/** Harder retry after a failure (Reckoning vow). */
export const HARDER: Record<Difficulty, Difficulty> = { easy: 'normal', normal: 'hard', hard: 'hard' };

interface QuestRule {
  stat: Stat;
  baseXp: number;
  /** Target per difficulty, in the quest's unit. */
  target: Record<Difficulty, number>;
  unit: string;
  title: string;
}

export const QUEST_RULES: Record<QuestType, QuestRule> = {
  pushup: { stat: 'STR', baseXp: 20, target: { easy: 10, normal: 20, hard: 40 }, unit: 'reps', title: 'Push-ups' },
  squat: { stat: 'STR', baseXp: 20, target: { easy: 15, normal: 25, hard: 50 }, unit: 'reps', title: 'Squats' },
  punch: { stat: 'STR', baseXp: 15, target: { easy: 30, normal: 60, hard: 120 }, unit: 'reps', title: 'Punches' },
  jumpingjack: { stat: 'VIT', baseXp: 15, target: { easy: 20, normal: 40, hard: 80 }, unit: 'reps', title: 'Jumping jacks' },
  situp: { stat: 'VIT', baseXp: 20, target: { easy: 15, normal: 25, hard: 50 }, unit: 'reps', title: 'Sit-ups' },
  jail: { stat: 'FOCUS', baseXp: 30, target: { easy: 20, normal: 25 * 60, hard: 50 * 60 }, unit: 'seconds', title: 'Phone Jail' },
  meditate: { stat: 'FOCUS', baseXp: 25, target: { easy: 60, normal: 5 * 60, hard: 10 * 60 }, unit: 'seconds', title: 'Meditate' },
  lightsout: { stat: 'DISCIPLINE', baseXp: 25, target: { easy: 1, normal: 1, hard: 1 }, unit: 'lights out', title: 'Lights out' },
  run: { stat: 'VIT', baseXp: 40, target: { easy: 1, normal: 3, hard: 5 }, unit: 'km', title: 'Run' },
  steps: { stat: 'VIT', baseXp: 25, target: { easy: 5000, normal: 8000, hard: 12000 }, unit: 'steps', title: 'Steps' },
  workout: { stat: 'STR', baseXp: 35, target: { easy: 15, normal: 30, hard: 60 }, unit: 'minutes', title: 'Workout' },
  sleep: { stat: 'DISCIPLINE', baseXp: 30, target: { easy: 6, normal: 7, hard: 8 }, unit: 'hours', title: 'Sleep' },
  photo: { stat: 'DISCIPLINE', baseXp: 20, target: { easy: 1, normal: 1, hard: 1 }, unit: 'photo', title: 'Photo proof' },
  gate: { stat: 'CHA', baseXp: 60, target: { easy: 1, normal: 1, hard: 1 }, unit: 'field vow', title: 'Field Vow' },
  quiz: { stat: 'INT', baseXp: 30, target: { easy: 1, normal: 1, hard: 1 }, unit: 'trial', title: 'Mind Trial' },
};

export function xpFor(type: QuestType, difficulty: Difficulty): number {
  return Math.round(QUEST_RULES[type].baseXp * DIFFICULTY_MULTIPLIER[difficulty]);
}

export function defaultTitle(type: QuestType, target: number): string {
  const rule = QUEST_RULES[type];
  return `${rule.title}: ${target} ${rule.unit}`;
}

export interface QuestTemplate {
  type: QuestType;
  difficulty: Difficulty;
}

/** Fallback daily vows (the Gemini designer replaces this when available). */
export const DAILY_TEMPLATES: readonly QuestTemplate[] = [
  { type: 'pushup', difficulty: 'normal' },
  { type: 'squat', difficulty: 'normal' },
  { type: 'jail', difficulty: 'normal' },
  { type: 'steps', difficulty: 'normal' },
  { type: 'quiz', difficulty: 'normal' },
];

/** 4-char display text for a rank, e.g. 'RK-E'. */
export function rankSegment(rank: Rank): `SEG:${string}` {
  return `SEG:RK-${rank}`;
}

/** 4-char right-aligned number for the display, clamped to 0..9999. */
export function segNumber(n: number): `SEG:${string}` {
  return `SEG:${String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, ' ')}`;
}

/** End of the local day containing `now`. */
export function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}
