/**
 * Lights out (light sensor A0): the room must go dark before the quest deadline.
 *
 * - The first BASELINE_SAMPLES light readings are the lit room (median) → threshold =
 *   max(MIN_DARK_THRESHOLD, baseline × DARK_FRACTION).
 * - Light below the threshold continuously for DARK_HOLD_MS → done (a hand shadow is too short).
 * - Missing the deadline is the engine's job (expiry sweep), not this verifier's.
 */
import type { Reading } from '../../lib/schemas';
import type { Verifier, VerifierEvent } from './types';

export const BASELINE_SAMPLES = 10;
export const DARK_FRACTION = 0.25;
export const MIN_DARK_THRESHOLD = 30;
export const DARK_HOLD_MS = 2_000;

export class LightsOutVerifier implements Verifier {
  private readonly calibration: number[] = [];
  private threshold: number | null = null;
  private darkSince: number | null = null;
  private finished = false;

  get darkThreshold(): number | null {
    return this.threshold;
  }

  push(reading: Reading): VerifierEvent[] {
    if (this.finished || reading.light === undefined) return [];
    if (this.threshold === null) {
      this.calibrate(reading.light);
      return [];
    }
    if (reading.light >= this.threshold) {
      this.darkSince = null;
      return [];
    }
    if (this.darkSince === null || reading.t < this.darkSince) this.darkSince = reading.t;
    if (reading.t - this.darkSince < DARK_HOLD_MS) return [];
    this.finished = true;
    return [{ type: 'progress', value: 1 }, { type: 'device', cmd: 'SEG:DARK' }, { type: 'done' }];
  }

  private calibrate(light: number): void {
    this.calibration.push(light);
    if (this.calibration.length < BASELINE_SAMPLES) return;
    const sorted = [...this.calibration].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)];
    this.threshold = Math.max(MIN_DARK_THRESHOLD, baseline * DARK_FRACTION);
  }
}
