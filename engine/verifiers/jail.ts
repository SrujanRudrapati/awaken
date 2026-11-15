/**
 * Phone Jail: the phone must sit in the jail for the whole quest. Servo D5 locks it if fitted.
 *
 * Phone presence: the IR reflective sensor (D7, `jail`) when it reports; otherwise the light
 * sensor (A0) covered by the phone — darker than COVERED_FRACTION of the brightest ambient
 * light seen during THIS vow (the verifier only exists while a jail vow is active, so a dark
 * room at any other time means nothing). The room must reach MIN_AMBIENT_LIGHT first, so:
 * start the vow, then put the phone down on the sensor.
 *
 *   waiting ── jail=1 ──▶ LOCK, locked ── held `target` s ──▶ UNLOCK, done
 *                              └── jail=0 for > FLICKER_GRACE_MS ──▶ UNLOCK, fail
 *
 * - IR flicker shorter than FLICKER_GRACE_MS is ignored (the time still counts).
 * - Each new whole second: `progress` + a SEG countdown of the seconds left.
 * - A resumed quest keeps the seconds already held.
 * Readings with neither `jail` nor `light` (phone / Watch) are ignored. Time comes from reading.t only.
 */
import type { Reading } from '../../lib/schemas';
import { segNumber } from '../progression';
import type { Verifier, VerifierEvent, VerifierQuest } from './types';

export const FLICKER_GRACE_MS = 1_000;
/** Light-sensor fallback: "covered" = at most this fraction of the vow's ambient maximum. */
export const COVERED_FRACTION = 0.35;
/** Ambient light (0–1023) needed before a covered sensor can be told apart from a dark room. */
export const MIN_AMBIENT_LIGHT = 150;
export const REASON_REMOVED = 'Phone removed from the jail early';

type JailState = 'waiting' | 'locked' | 'finished';

export class JailVerifier implements Verifier {
  private state: JailState = 'waiting';
  /** Reading time at which the held seconds started counting (adjusted for prior progress). */
  private startT = 0;
  private lastSeenT = 0;
  private lastT: number | null = null;
  private shownSeconds: number;
  private irSeen = false;
  private ambientMax = 0;

  constructor(private readonly quest: VerifierQuest) {
    this.shownSeconds = Math.floor(quest.progress);
  }

  /** 1/0 phone present, or null if this reading can't tell. */
  private phonePresent(reading: Reading): 0 | 1 | null {
    if (reading.jail !== undefined) {
      this.irSeen = true;
      return reading.jail;
    }
    if (this.irSeen || reading.light === undefined) return null;
    this.ambientMax = Math.max(this.ambientMax, reading.light);
    if (this.ambientMax < MIN_AMBIENT_LIGHT) return null;
    return reading.light <= this.ambientMax * COVERED_FRACTION ? 1 : 0;
  }

  push(reading: Reading): VerifierEvent[] {
    if (this.state === 'finished') return [];
    const present = this.phonePresent(reading);
    if (present === null) return [];
    if (this.lastT !== null && reading.t < this.lastT) return this.fail(); // device rebooted mid-lock
    this.lastT = reading.t;

    if (this.state === 'waiting') return present === 1 ? this.lock(reading.t) : [];
    if (present === 1) {
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
