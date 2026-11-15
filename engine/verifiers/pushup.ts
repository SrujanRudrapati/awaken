/**
 * Push-up rep counter (SPEC §3): ultrasonic distance state machine.
 *
 *   top ──dist < up−5──▶ descending ──dist ≤ down+3──▶ down ──dist ≥ up−5──▶ top  = rep
 *                           └─ went below the midpoint, back to top without reaching down
 *                              = rep.rejected ("not deep enough")
 *
 * Noise handling: 3-sample median, out-of-range samples dropped, separate up/down
 * thresholds (hysteresis), and excursions shorter than MIN_REP_MS ignored.
 */
import type { Reading } from '../../lib/schemas';
import { MedianFilter } from './smoothing';
import type { Verifier, VerifierEvent } from './types';

export const DEFAULT_UP_CM = 40;
export const DEFAULT_DOWN_CM = 10;
/** DOWN is reached at downDist + this. */
export const DOWN_MARGIN_CM = 3;
/** Back at the top at upDist − this. */
export const UP_MARGIN_CM = 5;
/** Smallest up−down range that keeps down / midpoint / up thresholds apart. */
export const MIN_CALIBRATION_RANGE_CM = 12;
/** Ultrasonic ranger limits: readings outside are missed echoes, not distances. */
export const MIN_VALID_CM = 2;
export const MAX_VALID_CM = 400;
export const MIN_REP_MS = 500;
export const REASON_NOT_DEEP_ENOUGH = 'not deep enough';

type Phase = 'top' | 'descending' | 'down';

export interface PushupCalibration {
  upDist: number;
  downDist: number;
}

/** Throws RangeError unless the calibration is usable. */
export function assertPushupCalibration(upDist: number, downDist: number): void {
  const valid =
    Number.isFinite(upDist) &&
    Number.isFinite(downDist) &&
    downDist > 0 &&
    upDist <= MAX_VALID_CM &&
    upDist - downDist >= MIN_CALIBRATION_RANGE_CM;
  if (!valid) {
    throw new RangeError(
      `Invalid calibration (up ${upDist} cm, down ${downDist} cm): need 0 < down, up ≤ ${MAX_VALID_CM}, ` +
        `and up at least ${MIN_CALIBRATION_RANGE_CM} cm above down`,
    );
  }
}

export class PushupCounter implements Verifier {
  private upDist = DEFAULT_UP_CM;
  private downDist = DEFAULT_DOWN_CM;
  private reps = 0;
  private phase: Phase = 'top';
  private excursionStart = 0;
  private wentBelowMid = false;
  private lastT: number | null = null;
  private readonly filter = new MedianFilter();

  get count(): number {
    return this.reps;
  }

  /** upDist = arms extended, downDist = chest at the bottom (cm from the sensor). */
  calibrate(upDist: number, downDist: number): void {
    assertPushupCalibration(upDist, downDist);
    this.upDist = upDist;
    this.downDist = downDist;
  }

  push(reading: Reading): VerifierEvent[] {
    if (this.lastT !== null && reading.t < this.lastT) this.abandonExcursion(); // device rebooted
    this.lastT = reading.t;

    if (reading.dist < MIN_VALID_CM || reading.dist > MAX_VALID_CM) return [];
    return this.step(this.filter.push(reading.dist), reading.t);
  }

  private step(dist: number, t: number): VerifierEvent[] {
    const upThreshold = this.upDist - UP_MARGIN_CM;
    const downThreshold = this.downDist + DOWN_MARGIN_CM;
    const midpoint = (this.upDist + this.downDist) / 2;

    if (this.phase === 'top') {
      if (dist >= upThreshold) return [];
      this.phase = 'descending';
      this.excursionStart = t;
      this.wentBelowMid = false;
    }

    if (dist >= upThreshold) return this.finishExcursion(t);

    if (dist <= downThreshold) this.phase = 'down';
    else if (dist < midpoint) this.wentBelowMid = true;
    return [];
  }

  /** Back at the top: decide what the excursion was. */
  private finishExcursion(t: number): VerifierEvent[] {
    const reachedDown = this.phase === 'down';
    const wasHalfRep = this.wentBelowMid;
    const longEnough = t - this.excursionStart >= MIN_REP_MS;
    this.phase = 'top';
    this.wentBelowMid = false;

    if (!longEnough) return []; // too fast to be a person — a glitch
    if (reachedDown) {
      this.reps += 1;
      return [{ type: 'rep', count: this.reps }];
    }
    return wasHalfRep ? [{ type: 'rep.rejected', reason: REASON_NOT_DEEP_ENOUGH }] : [];
  }

  private abandonExcursion(): void {
    this.phase = 'top';
    this.wentBelowMid = false;
    this.filter.reset();
  }
}
