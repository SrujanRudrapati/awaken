/**
 * Push-up rep counter for the Home Base pad / micro switch (D6): chest presses the pad at the bottom.
 *
 *   pad 0 ──▶ 1 (chest down) ──▶ 0 (back up) = 1 rep, counted on release.
 *
 * - Debounce: a new pad state counts only once it has held for DEBOUNCE_MS.
 * - Pressed longer than MAX_HOLD_MS = resting on the pad, not a rep (ignored).
 * - Releases closer than MIN_REP_MS to the previous rep → rep.rejected 'too fast'.
 * Readings without `pad` (e.g. from the phone) are ignored.
 */
import type { Bit, Reading } from '../../lib/schemas';
import type { Verifier, VerifierEvent } from './types';

export const DEBOUNCE_MS = 80;
export const MIN_REP_MS = 600;
export const MAX_HOLD_MS = 3_000;
export const REASON_TOO_FAST = 'too fast';

export class PadPushupCounter implements Verifier {
  private reps = 0;
  private stable: Bit = 0;
  private candidate: { state: Bit; since: number } | null = null;
  private pressedAt: number | null = null;
  private lastRepT: number | null = null;
  private lastT: number | null = null;

  get count(): number {
    return this.reps;
  }

  push(reading: Reading): VerifierEvent[] {
    if (reading.pad === undefined) return [];
    if (this.lastT !== null && reading.t < this.lastT) this.resetTiming(); // device rebooted
    this.lastT = reading.t;

    const changed = this.debounce(reading.pad, reading.t);
    if (changed === null) return [];
    return changed.state === 1 ? this.onPress(changed.at) : this.onRelease(changed.at);
  }

  /** Returns the new stable state (and when it began) once it has held DEBOUNCE_MS, else null. */
  private debounce(pad: Bit, t: number): { state: Bit; at: number } | null {
    if (pad === this.stable) {
      this.candidate = null; // bounce back to the stable state
      return null;
    }
    if (!this.candidate || this.candidate.state !== pad) {
      this.candidate = { state: pad, since: t };
      return null;
    }
    if (t - this.candidate.since < DEBOUNCE_MS) return null;
    const at = this.candidate.since;
    this.stable = pad;
    this.candidate = null;
    return { state: pad, at };
  }

  private onPress(at: number): VerifierEvent[] {
    this.pressedAt = at;
    return [];
  }

  private onRelease(at: number): VerifierEvent[] {
    const pressedAt = this.pressedAt;
    this.pressedAt = null;
    if (pressedAt === null) return []; // released a press we never saw start
    if (at - pressedAt > MAX_HOLD_MS) return []; // resting on the pad

    if (this.lastRepT !== null && at - this.lastRepT < MIN_REP_MS) {
      return [{ type: 'rep.rejected', reason: REASON_TOO_FAST }];
    }
    this.reps += 1;
    this.lastRepT = at;
    return [{ type: 'rep', count: this.reps }];
  }

  private resetTiming(): void {
    this.stable = 0;
    this.candidate = null;
    this.pressedAt = null;
    this.lastRepT = null;
  }
}
