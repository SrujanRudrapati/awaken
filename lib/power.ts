/**
 * Rank from Power (pure).
 *
 *   Power = Σ_stats √(Proof in that stat) + BALANCE_WEIGHT × min_stats √(Proof)
 *
 * The square root makes each stat's Proof matter less the more you pile into it; the balance
 * term rewards training everything (your weakest stat lifts all of it). Rank letters E → A
 * are bands of Power. Proof for rep / timed vows scales to the person's own Calibration
 * baseline, so a beginner's 20 push-ups weigh more than an athlete's.
 */
import type { Player, Quest, Rank, Stat } from './schemas';
import { StatSchema } from './schemas';

export const BALANCE_WEIGHT = 3;

/** Minimum Power per rank, top first. */
export const POWER_THRESHOLDS: readonly (readonly [Rank, number])[] = [
  ['A', 250],
  ['B', 140],
  ['C', 70],
  ['D', 30],
  ['E', 0],
];

export type StatProof = Record<Stat, number>;

export function zeroProof(): StatProof {
  return Object.fromEntries(StatSchema.options.map((s) => [s, 0])) as StatProof;
}

export function proofOf(player: Pick<Player, 'proof'>): StatProof {
  return { ...zeroProof(), ...(player.proof ?? {}) };
}

export function power(proof: StatProof): number {
  const roots = StatSchema.options.map((s) => Math.sqrt(Math.max(0, proof[s])));
  const total = roots.reduce((a, b) => a + b, 0) + BALANCE_WEIGHT * Math.min(...roots);
  return Math.round(total * 10) / 10;
}

export function rankForPower(value: number): Rank {
  return POWER_THRESHOLDS.find(([, min]) => value >= min)?.[0] ?? 'E';
}

export function nextRankThreshold(rank: Rank): number | null {
  const index = POWER_THRESHOLDS.findIndex(([r]) => r === rank);
  return index > 0 ? POWER_THRESHOLDS[index - 1][1] : null;
}

/** Proof needed in `stat` to reach the next rank (0 at A). Ignores the balance term (conservative). */
export function proofToNextRank(proof: StatProof, stat: Stat): number {
  const target = nextRankThreshold(rankForPower(power(proof)));
  if (target === null) return 0;
  const gap = target - power(proof);
  if (gap <= 0) return 0;
  const root = Math.sqrt(proof[stat]);
  return Math.ceil((root + gap) ** 2 - proof[stat]);
}

/** The four stats Calibration measures (DEMO_MODE spreads urgent-vow Proof over these). */
export const MEASURED_STATS: readonly Stat[] = ['STR', 'VIT', 'INT', 'FOCUS'];

/** Adds `amount` split evenly over `stats` (remainder to the first). */
export function spreadProof(proof: StatProof, amount: number, stats: readonly Stat[] = MEASURED_STATS): StatProof {
  const each = Math.floor(amount / stats.length);
  const next = { ...proof };
  stats.forEach((s, i) => {
    next[s] += each + (i === 0 ? amount - each * stats.length : 0);
  });
  return next;
}

/** Smallest total Proof that, spread over MEASURED_STATS, reaches the next rank (0 at A). */
export function spreadProofToNextRank(proof: StatProof): number {
  const target = nextRankThreshold(rankForPower(power(proof)));
  if (target === null) return 0;
  let amount = 0;
  while (power(spreadProof(proof, amount)) < target) amount += MEASURED_STATS.length;
  return amount;
}

/**
 * Proof per measured stat so a fresh Calibration lands exactly in `rank`'s band:
 * the band's threshold split evenly over the four measured stats.
 */
export function seedProofForRank(rank: Rank): StatProof {
  const threshold = POWER_THRESHOLDS.find(([r]) => r === rank)?.[1] ?? 0;
  const each = Math.ceil((threshold / 4) ** 2);
  return { ...zeroProof(), STR: each, VIT: each, INT: each, FOCUS: each };
}

export interface Baselines {
  /** Max reps in the Calibration body test (push-ups / wall push-ups / chair squats). */
  bodyReps?: number;
  /** Jumping jacks in 60 s. */
  jumpingJacks?: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
/** Reference rep counts the base Proof table was written for. */
const REFERENCE_BODY_REPS = 25;
const REFERENCE_JACKS = 45;

/** Multiplier for a rep vow against the person's own baseline (√ so it never runs away). */
export function proofScale(quest: Pick<Quest, 'type' | 'stat'>, baselines: Baselines | null): number {
  if (!baselines) return 1;
  const body = ['pushup', 'squat', 'situp', 'punch'].includes(quest.type) ? baselines.bodyReps : undefined;
  const jacks = quest.type === 'jumpingjack' ? baselines.jumpingJacks : undefined;
  const baseline = body ?? jacks;
  if (!baseline || baseline <= 0) return 1;
  const reference = body !== undefined ? REFERENCE_BODY_REPS : REFERENCE_JACKS;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.sqrt(reference / baseline)));
}
