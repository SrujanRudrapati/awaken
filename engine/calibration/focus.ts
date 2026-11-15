/**
 * Calibration · Focus: 60 s go/no-go. The server makes the schedule (when each stimulus
 * appears and whether it is GO = tap or NO-GO = hold still); the client shows it and reports
 * a reaction time per trial; code scores it. Too-fast taps (< 120 ms) are guesses.
 */
import { MAX_RT_MS, MIN_RT_MS, type FocusResult } from './norms';

export const FOCUS_DURATION_MS = 60_000;
const FIRST_TRIAL_MS = 1_500;
const TRIAL_GAP_MS = 1_300;
const NOGO_SHARE = 0.25;
const MIN_NOGO = 8;

export interface Trial {
  i: number;
  /** ms after the client starts the test. */
  atMs: number;
  kind: 'go' | 'nogo';
}

export interface TrialResponse {
  i: number;
  /** ms from stimulus to tap, or null for no tap. */
  rtMs: number | null;
}

export function buildTrials(random: () => number = Math.random): Trial[] {
  const count = Math.floor((FOCUS_DURATION_MS - FIRST_TRIAL_MS) / TRIAL_GAP_MS);
  const kinds = Array.from({ length: count }, (_, i) => (i < Math.max(MIN_NOGO, Math.round(count * NOGO_SHARE)) ? 'nogo' : 'go') as Trial['kind']);
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.map((kind, i) => ({ i, atMs: FIRST_TRIAL_MS + i * TRIAL_GAP_MS, kind }));
}

/** Unknown trial indexes are ignored; a missing response = no tap. */
export function scoreTrials(trials: readonly Trial[], responses: readonly TrialResponse[]): FocusResult {
  const byTrial = new Map(responses.map((r) => [r.i, r.rtMs]));
  const result: FocusResult = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, meanRtMs: null };
  const hitTimes: number[] = [];
  for (const trial of trials) {
    const rt = byTrial.get(trial.i) ?? null;
    const tapped = rt !== null;
    if (trial.kind === 'go') {
      if (tapped && rt >= MIN_RT_MS && rt <= MAX_RT_MS) {
        result.hits += 1;
        hitTimes.push(rt);
      } else result.misses += 1;
    } else if (tapped) result.falseAlarms += 1;
    else result.correctRejections += 1;
  }
  result.meanRtMs = hitTimes.length ? Math.round(hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length) : null;
  return result;
}
