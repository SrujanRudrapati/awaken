/**
 * Phone Jail (IR D6 + servo D5): the phone must sit in the jail for the whole quest.
 *
 *   waiting ── jail=1 ──▶ LOCK, locked ── held `target` s ──▶ UNLOCK, done
 *                              └── jail=0 for > FLICKER_GRACE_MS ──▶ UNLOCK, fail
 *
 * - IR flicker shorter than FLICKER_GRACE_MS is ignored (the time still counts).
 * - Each new whole second: `progress` + a SEG countdown of the seconds left.
 * - A resumed quest keeps the seconds already held.
 * Readings without `jail` (phone / Watch) are ignored. Time comes from reading.t only.
 */
import type { Reading } from '../../lib/schemas';
import { segNumber } from '../progression';
import type { Verifier, VerifierEvent, VerifierQuest } from './types';

export const FLICKER_GRACE_MS = 1_000;
export const REASON_REMOVED = 'Phone removed from the jail early';

type JailState = 'waiting' | 'locked' | 'finished';

export class JailVerifier implements Verifier {
  private state: JailState = 'waiting';
  /** Reading time at which the held seconds started counting (adjusted for prior progress). */
  private startT = 0;
  private lastSeenT = 0;
  private lastT: number | null = null;
  private shownSeconds: number;

  constructor(private readonly quest: VerifierQuest) {
    this.shownSeconds = Math.floor(quest.progress);
  }

  push(reading: Reading): VerifierEvent[] {
    if (reading.jail === undefined || this.state === 'finished') return [];
    if (this.lastT !== null && reading.t < this.lastT) return this.fail(); // device rebooted mid-lock
    this.lastT = reading.t;

    if (this.state === 'waiting') return reading.jail === 1 ? this.lock(reading.t) : [];
    if (reading.jail === 1) {
      this.lastSeenT = reading.t;
      return this.tick(reading.t);
    }
    return reading.t - this.lastSeenT > FLICKER_GRACE_MS ? this.fail() : this.tick(reading.t);
  }

  private lock(t: number): VerifierEvent[] {
    this.state = 'locked';
    this.startT = t - this.quest.progress * 1_000;
    this.lastSeenT = t;
    return [{ type: 'device', cmd: 'LOCK' }, { type: 'device', cmd: segNumber(this.quest.target - this.quest.progress) }];
  }

  private tick(t: number): VerifierEvent[] {
    const held = Math.min(this.quest.target, Math.floor((t - this.startT) / 1_000));
    if (held >= this.quest.target) {
      this.state = 'finished';
      return [{ type: 'progress', value: this.quest.target }, { type: 'device', cmd: 'UNLOCK' }, { type: 'done' }];
    }
    if (held <= this.shownSeconds) return [];
    this.shownSeconds = held;
    return [{ type: 'progress', value: held }, { type: 'device', cmd: segNumber(this.quest.target - held) }];
  }

  private fail(): VerifierEvent[] {
    this.state = 'finished';
    return [{ type: 'device', cmd: 'UNLOCK' }, { type: 'fail', reason: REASON_REMOVED }];
  }
}
