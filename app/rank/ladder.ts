/** Rank ladder maths for the Rank screen (pure, unit-tested). Ranks are letters E → A; A is the top. */
import { POWER_THRESHOLDS, nextRankThreshold, power, proofOf, rankForPower } from '../../lib/power';
import type { Player, Rank, Stat } from '../../lib/schemas';

export const RANKS: readonly Rank[] = ['E', 'D', 'C', 'B', 'A'];

export interface RankProgress {
  rank: Rank;
  power: number;
  /** Next letter, or null at A. */
  next: Rank | null;
  /** Power the next letter needs, or null at A. */
  nextAt: number | null;
  /** 0–1 through the current band (1 at A). */
  fraction: number;
}

export function rankProgress(person: Pick<Player, 'proof'>): RankProgress {
  const value = power(proofOf(person));
  const rank = rankForPower(value);
  const floor = POWER_THRESHOLDS.find(([letter]) => letter === rank)?.[1] ?? 0;
  const nextAt = nextRankThreshold(rank);
  const next = nextAt === null ? null : RANKS[RANKS.indexOf(rank) + 1] ?? null;
  const fraction = nextAt === null ? 1 : Math.max(0, Math.min(1, (value - floor) / (nextAt - floor)));
  return { rank, power: value, next, nextAt, fraction };
}

export type RungState = 'done' | 'now' | 'ahead';

export function rungState(rung: Rank, current: Rank): RungState {
  const delta = RANKS.indexOf(rung) - RANKS.indexOf(current);
  return delta < 0 ? 'done' : delta === 0 ? 'now' : 'ahead';
}

export interface DayProof {
  day: string;
  /** "Mon" */
  label: string;
  proof: number;
}

const DAY_MS = 86_400_000;

/** Proof per day for the last `days` days ending today (days with nothing are 0). */
export function dailyProof(history: readonly { day: string; stat: Stat; xp: number }[], today: Date, days = 7): DayProof[] {
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(end - (days - 1 - i) * DAY_MS);
    const day = date.toISOString().slice(0, 10);
    const proof = history.filter((row) => row.day.slice(0, 10) === day).reduce((sum, row) => sum + row.xp, 0);
    return { day, label: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), proof };
  });
}

/** Bar length for a stat's Proof: square-root scale, like Power itself. */
export function statFraction(proof: number, maxProof: number): number {
  if (maxProof <= 0) return 0;
  return Math.max(0, Math.min(1, Math.sqrt(proof) / Math.sqrt(maxProof)));
}

export interface BoardEntry<T> {
  position: number;
  member: T;
}

/** The top of the board, always including the signed-in person (their row replaces the last one if they are lower). */
export function boardWindow<T extends { id: string }>(members: readonly T[], myId: string | null, size = 7): BoardEntry<T>[] {
  const ranked = members.map((member, index) => ({ position: index + 1, member }));
  const top = ranked.slice(0, size);
  const mine = ranked.find((entry) => entry.member.id === myId);
  if (!mine || mine.position <= size) return top;
  return [...top.slice(0, size - 1), mine];
}
