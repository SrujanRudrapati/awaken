/**
 * Squat rep counter (SPEC §3): accelerometer magnitude peak with hysteresis.
 * A rep = smoothed |a| rises above HIGH_G, then falls below LOW_G, at least
 * MIN_INTERVAL_MS after the previous rep. Magnitude makes it orientation-independent;
 * the 3-sample median drops single-sample bumps.
 * Thresholds are tuned against the simulator — re-tune on real hardware (BACKEND_STEPS 5.6).
 */
import type { Reading } from '../../lib/schemas';
import { MedianFilter } from './smoothing';
import type { Verifier, VerifierEvent } from './types';

export const HIGH_G = 1.4;
export const LOW_G = 1.1;
export const MIN_INTERVAL_MS = 800;

export class SquatCounter implements Verifier {
  private reps = 0;
  private inPeak = false;
  private lastRepT: number | null = null;
  private lastT: number | null = null;
  private readonly filter = new MedianFilter();

  get count(): number {
    return this.reps;
  }

  push(reading: Reading): VerifierEvent[] {
    if (this.lastT !== null && reading.t < this.lastT) this.resetTiming(); // device rebooted
    this.lastT = reading.t;

    const magnitude = this.filter.push(Math.hypot(reading.ax, reading.ay, reading.az));

    if (!this.inPeak) {
      if (magnitude > HIGH_G) this.inPeak = true;
      return [];
    }
    if (magnitude >= LOW_G) return [];

    this.inPeak = false;
    const tooSoon = this.lastRepT !== null && reading.t - this.lastRepT < MIN_INTERVAL_MS;
    if (tooSoon) return [];

    this.reps += 1;
    this.lastRepT = reading.t;
    return [{ type: 'rep', count: this.reps }];
  }

  private resetTiming(): void {
    this.inPeak = false;
    this.lastRepT = null;
    this.filter.reset();
  }
}
