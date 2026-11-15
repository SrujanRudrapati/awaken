/** The go / no-go focus test, client side (pure, unit-tested): which stimulus is showing, and what gets submitted. */
import type { FocusTrial } from '../../components/oath/api';

/** How long each stimulus stays up. */
export const STIMULUS_MS = 1_000;

/** The trial on screen at `elapsedMs` since the clock started, if any. */
export function stimulusAt(trials: readonly FocusTrial[], elapsedMs: number): FocusTrial | null {
  return trials.find((trial) => elapsedMs >= trial.atMs && elapsedMs < trial.atMs + STIMULUS_MS) ?? null;
}

/** Reaction times by trial index. Only the first tap on a stimulus counts. */
export type Taps = Readonly<Record<number, number>>;

export function recordTap(taps: Taps, trials: readonly FocusTrial[], elapsedMs: number): Taps {
  const trial = stimulusAt(trials, elapsedMs);
  if (!trial || taps[trial.i] !== undefined) return taps;
  return { ...taps, [trial.i]: Math.round(elapsedMs - trial.atMs) };
}

/** One response per trial: the reaction time, or null when it was left alone. */
export function toResponses(trials: readonly FocusTrial[], taps: Taps): { i: number; rtMs: number | null }[] {
  return trials.map((trial) => ({ i: trial.i, rtMs: taps[trial.i] ?? null }));
}

export function secondsLeft(endsAtIso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAtIso) - nowMs) / 1000));
}
