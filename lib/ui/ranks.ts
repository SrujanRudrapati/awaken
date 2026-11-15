/**
 * Display-only rank helpers. Thresholds mirror BACKEND_STEPS Phase 7; the quest
 * engine is the authority — the UI only uses these to draw the XP bar.
 */
import { RankSchema, StatSchema, type Rank, type Stat } from '../schemas';

export const RANKS: readonly Rank[] = RankSchema.options;
export const STATS: readonly Stat[] = StatSchema.options;

export const RANK_XP: Record<Rank, number> = { E: 0, D: 100, C: 300, B: 700, A: 1500, S: 3000 };

export const STAT_LABEL: Record<Stat, string> = {
  STR: 'Strength',
  INT: 'Intellect',
  FOCUS: 'Focus',
  VIT: 'Vitality',
  DISCIPLINE: 'Discipline',
  CHA: 'Charisma',
};

export function nextRank(rank: Rank): Rank | null {
  const i = RANKS.indexOf(rank);
  return i >= 0 && i < RANKS.length - 1 ? RANKS[i + 1] : null;
}

/** Fraction (0–1) of the way from `rank`'s threshold to the next one. 1 at S-Rank. */
export function rankProgress(xp: number, rank: Rank): { fraction: number; toNext: number | null } {
  const next = nextRank(rank);
  if (!next) return { fraction: 1, toNext: null };
  const floor = RANK_XP[rank];
  const span = RANK_XP[next] - floor;
  const fraction = Math.min(1, Math.max(0, (xp - floor) / span));
  return { fraction, toNext: Math.max(0, RANK_XP[next] - xp) };
}
