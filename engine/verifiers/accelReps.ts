/**
 * Generic accelerometer rep counter (phone armband / Watch): squat, jumping jack, sit-up, arm push-up.
 *
 * 1. Calibration — the first 2 slow reps. Each axis is watched for excursions away from its
 *    resting value (≥ CAL_MIN_G). The first axis to complete 2 out-and-back cycles becomes the
 *    dominant axis; the mean of its two signed peaks is one full rep's depth. Both
 *    calibration reps count.
 * 2. Counting — progress p = (value − rest) / depth on the dominant axis (1 = full rep).
 *      rest ──p ≥ START──▶ moving ──p ≤ RETURN──▶ rest
 *    On return: peak ≥ DEEP → rep (if ≥ MIN_REP_MS since the last rep, else 'too fast');
 *    START ≤ peak < DEEP → rep.rejected 'not deep enough'. Excursions < MIN_EXCURSION_MS are glitches.
 *
 * Works on accelerationIncludingGravity in g: tilting the limb swings gravity between axes,
 * so whichever axis moves most is the one to count. Readings without ax/ay/az are ignored.
 */
import type { Reading } from '../../lib/schemas';
import { MedianFilter } from './smoothing';
import type { Verifier, VerifierEvent } from './types';

export const ACCEL_EXERCISES = ['squat', 'jumpingjack', 'situp', 'armPushup'] as const;
export type AccelExercise = (typeof ACCEL_EXERCISES)[number];

/** Smallest excursion (g) that counts as a calibration rep. */
export const CAL_MIN_G = 0.3;
export const CALIBRATION_REPS = 2;
/** Progress thresholds as a fraction of the calibrated depth. */
export const START_FRACTION = 0.35;
export const RETURN_FRACTION = 0.2;
export const DEEP_FRACTION = 0.7;
export const MIN_REP_MS = 700;
export const MIN_EXCURSION_MS = 250;
export const REASON_NOT_DEEP_ENOUGH = 'not deep enough';
export const REASON_TOO_FAST = 'too fast';

/** Samples (after smoothing) averaged to find the resting value. */
const REST_SAMPLES = 3;
/** Slow drift correction of the resting value while at rest (EMA weight). */
const REST_DRIFT = 0.02;
/** A calibration excursion ends when back within this fraction of its peak. */
const CAL_RETURN_FRACTION = 0.3;

type Axis = 0 | 1 | 2;
const AXES: readonly Axis[] = [0, 1, 2];

interface AxisCalibration {
  out: boolean;
  peak: number; // signed, relative to rest
  peaks: number[];
}

interface Calibrated {
  axis: Axis;
  rest: number;
  depth: number; // signed
}

export class AccelRepCounter implements Verifier {
  private reps = 0;
  private readonly filters = AXES.map(() => new MedianFilter());
  private restSamples: number[][] = [];
  private rest: number[] | null = null;
  private calibration: AxisCalibration[] = AXES.map(() => ({ out: false, peak: 0, peaks: [] }));
  private calibrated: Calibrated | null = null;
  private moving: { since: number; peak: number } | null = null;
  private lastRepT: number | null = null;
  private lastT: number | null = null;

  constructor(readonly exercise: AccelExercise) {}

  get count(): number {
    return this.reps;
  }

  get isCalibrated(): boolean {
    return this.calibrated !== null;
  }

  push(reading: Reading): VerifierEvent[] {
    const { ax, ay, az, t } = reading;
    if (ax === undefined || ay === undefined || az === undefined) return [];
    if (this.lastT !== null && t < this.lastT) this.resetTiming(); // source restarted
    this.lastT = t;

    const values = [ax, ay, az].map((v, i) => this.filters[i].push(v));
    if (!this.rest) {
      this.collectRest(values);
      return [];
    }
    return this.calibrated ? this.countStep(values, t, this.calibrated) : this.calibrate(values);
  }

  private collectRest(values: number[]): void {
    this.restSamples = [...this.restSamples, values];
    if (this.restSamples.length < REST_SAMPLES) return;
    this.rest = AXES.map(
      (a) => this.restSamples.reduce((sum, s) => sum + s[a], 0) / this.restSamples.length,
    );
  }

  private calibrate(values: number[]): VerifierEvent[] {
    const rest = this.rest as number[];
    this.calibration = this.calibration.map((cal, a) => stepCalibration(cal, values[a] - rest[a]));

    const done = AXES.filter((a) => this.calibration[a].peaks.length >= CALIBRATION_REPS);
    if (done.length === 0) return [];

    const meanPeak = (a: Axis): number => mean(this.calibration[a].peaks);
    const axis = done.reduce((best, a) => (Math.abs(meanPeak(a)) > Math.abs(meanPeak(best)) ? a : best));
    this.calibrated = { axis, rest: rest[axis], depth: meanPeak(axis) };

    return Array.from({ length: CALIBRATION_REPS }, () => {
      this.reps += 1;
      return { type: 'rep', count: this.reps } as const;
    });
  }

  private countStep(values: number[], t: number, cal: Calibrated): VerifierEvent[] {
    const value = values[cal.axis];
    const progress = (value - cal.rest) / cal.depth;

    if (!this.moving) {
      if (progress >= START_FRACTION) {
        this.moving = { since: t, peak: progress };
      } else if (progress <= RETURN_FRACTION) {
        this.calibrated = { ...cal, rest: cal.rest + REST_DRIFT * (value - cal.rest) };
      }
      return [];
    }

    if (progress > RETURN_FRACTION) {
      this.moving = { ...this.moving, peak: Math.max(this.moving.peak, progress) };
      return [];
    }
    const { since, peak } = this.moving;
    this.moving = null;
    return this.finishExcursion(peak, since, t);
  }

  private finishExcursion(peak: number, since: number, t: number): VerifierEvent[] {
    if (t - since < MIN_EXCURSION_MS) return []; // glitch
    if (peak < DEEP_FRACTION) return [{ type: 'rep.rejected', reason: REASON_NOT_DEEP_ENOUGH }];
    if (this.lastRepT !== null && t - this.lastRepT < MIN_REP_MS) {
      return [{ type: 'rep.rejected', reason: REASON_TOO_FAST }];
    }
    this.reps += 1;
    this.lastRepT = t;
    return [{ type: 'rep', count: this.reps }];
  }

  private resetTiming(): void {
    this.moving = null;
    this.lastRepT = null;
    this.filters.forEach((f) => f.reset());
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** One calibration step for one axis; `away` is the signed offset from rest. */
function stepCalibration(cal: AxisCalibration, away: number): AxisCalibration {
  if (!cal.out) {
    return Math.abs(away) >= CAL_MIN_G ? { ...cal, out: true, peak: away } : cal;
  }
  const peak = Math.abs(away) > Math.abs(cal.peak) ? away : cal.peak;
  if (Math.abs(away) > Math.abs(peak) * CAL_RETURN_FRACTION) return { ...cal, peak };
  return { out: false, peak: 0, peaks: [...cal.peaks, peak] };
}
