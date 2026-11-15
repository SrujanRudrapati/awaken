/**
 * Jumping-jack counter for the phone/Watch (armband or pocket).
 *
 * A jack is not a vertical-travel exercise (the hop is a few cm) — it is a one-sided swing: the
 * arm (armband) or thigh (pocket) goes out to one side of its resting angle and back. Rotation
 * rate is ignored here: an armband jack swings the arm overhead at 300–500 °/s, as fast as
 * hand-waving. What tells them apart is that a jack never crosses to the other side of rest,
 * while waving swings both ways through it.
 *
 * Signal: the direction of the low-passed accel (≈ gravity in the phone frame) relative to its
 * resting direction. `s` = the angle between them (deg), signed by the swing direction learned in
 * calibration (+ = out). A rep: s climbs past START, peaks, comes back below RETURN.
 *
 * Judged in order (first failure = rep.rejected reason):
 *   1. since the last rep, the swing went to both sides of rest → 'phone waving': s past
 *      OPPOSITE_FRACTION of depth the other way, or (with gyro data) the rotation-rate-integrated
 *      swing angle went both ways (immune to the linear acceleration of a vigorous wave)
 *   2. out-and-back time outside MIN_JACK_MS…MAX_JACK_MS → 'too fast' / 'too slow'
 *   3. peak < DEEP_FRACTION of the calibrated swing → 'not deep enough' (by gyro angle when
 *      available — the accel direction under-reads an overhead arm swing)
 * Calibration: the first 2 swings ≥ CAL_MIN_SWING that pass 2 and go the same way set the
 * swing direction and depth, and both count. Swings that alternate sides never calibrate.
 */
import type { Reading } from '../../lib/schemas';
import { DEEP_FRACTION, REASON_NOT_DEEP_ENOUGH, REASON_TOO_FAST, REASON_TOO_SLOW, START_FRACTION } from './accelReps';
import type { RepDebug } from './repDebug';
import { MedianFilter } from './smoothing';
import type { Verifier, VerifierEvent } from './types';
import type { Vec3 } from './verticalMotion';

export const CALIBRATION_JACKS = 2;
/** Smallest swing (degrees between resting and current gravity direction) that can calibrate. */
export const CAL_MIN_SWING = 20;
/** A swing has ended once back below this fraction of depth (of its own peak while calibrating). */
export const RETURN_FRACTION_JACK = 0.25;
/** The other side of rest by this fraction of depth since the last rep = waving, not a jack. */
export const OPPOSITE_FRACTION = 0.3;
export const MIN_JACK_MS = 450;
export const MAX_JACK_MS = 3_000;
export const REASON_WAVING = 'phone waving';
/** Low-pass of the accel direction: smooths hop impacts, keeps up with a 1 s arm swing. */
const DIRECTION_TAU_S = 0.12;
/**
 * Gyro check: the swing angle (rotationRate integrated since rest) went both ways — the smaller
 * side ≥ this fraction of the larger, and the larger ≥ GYRO_MIN_SWING_DEG — means waving.
 */
export const GYRO_TWO_SIDED_FRACTION = 0.35;
const GYRO_MIN_SWING_DEG = 20;
const GYRO_BUFFER_MS = MAX_JACK_MS + 1_000;
/** Resting = the direction held within REST_CHORD (≈ 2°) for REST_MS. */
const REST_MS = 400;
const REST_CHORD = 0.035;


interface Swing {
  startT: number;
  peak: number;
  /** Which way the swing set off (unit). Measured along this, crossing rest ends the swing. */
  dir: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
/** Angle (deg) between two unit vectors from their difference (chord), signed along `dir`. */
const swingDeg = (dev: Vec3, dir: Vec3): number =>
  ((2 * Math.asin(Math.min(1, length(dev) / 2)) * 180) / Math.PI) * dot(unit(dev), dir);
const unit = (a: Vec3): Vec3 => {
  const n = length(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};

export class JackRepCounter implements Verifier {
  private reps = 0;
  private readonly filters = [new MedianFilter(), new MedianFilter(), new MedianFilter()];
  private recent: { t: number; dir: Vec3 }[] = [];
  /** Swing angle (deg) from the rotation rate, integrated since the last rest or accepted swing. */
  private theta: Vec3 = [0, 0, 0];
  /** theta samples since the last finished swing. */
  private thetas: Vec3[] = [];
  private thetaTimes: number[] = [];
  private lowPass: Vec3 | null = null;
  private rest: Vec3 | null = null;
  private lastT: number | null = null;
  private swing: Swing | null = null;
  /** When s was last back at rest (a swing starts from here). */
  private restT = 0;
  /** Most negative s since the last finished swing (waving goes the other way). */
  private opposite = 0;
  /** Calibration swings: which way (unit), how far (deg, accel), how far by gyro (deg, if any). */
  private calibration: { dev: Vec3; peak: number; gyroPeak: number | null }[] = [];
  /** Calibrated swing by gyro (deg); null when calibration had no gyro data. */
  private gyroDepth: number | null = null;
  private direction: Vec3 | null = null;
  private depth: number | null = null;
  private debug: RepDebug = { calibrated: false, progress: 0 };

  get count(): number {
    return this.reps;
  }

  get isCalibrated(): boolean {
    return this.depth !== null;
  }

  get debugState(): RepDebug {
    return this.debug;
  }

  push(reading: Reading): VerifierEvent[] {
    const { ax, ay, az, t } = reading;
    if (ax === undefined || ay === undefined || az === undefined) return [];
    if (this.lastT !== null && t < this.lastT) this.restart();
    const dt = this.lastT === null ? 0 : Math.min((t - this.lastT) / 1000, 0.2);
    this.lastT = t;

    const accel = [ax, ay, az].map((v, i) => this.filters[i].push(v)) as unknown as Vec3;
    const alpha = dt / (DIRECTION_TAU_S + dt);
    const lp: Vec3 = this.lowPass ? (this.lowPass.map((v, i) => v + alpha * (accel[i] - v)) as unknown as Vec3) : accel;
    this.lowPass = lp;
    const direction = unit(lp);
    const resting = !this.rest || (this.isResting(t, direction) && !this.swing);
    const rest = resting ? direction : (this.rest as Vec3);
    this.rest = rest;
    if (resting) {
      // At rest, whatever the phone did before (e.g. waving) is over.
      this.opposite = 0;
      this.thetas = [];
      this.thetaTimes = [];
    }
    this.integrateRotation(reading, t, dt, resting);

    const dev = sub(direction, rest);
    return this.depth === null ? this.calibrate(dev, t) : this.countSwing(dev, t);
  }

  /** Before calibration: unsigned swings; record which way each went. */
  private calibrate(dev: Vec3, t: number): VerifierEvent[] {
    if (!this.swing) {
      const size = swingDeg(dev, unit(dev));
      this.track(size);
      if (size < CAL_MIN_SWING) {
        this.restT = t;
        return [];
      }
      this.swing = { startT: this.restT, peak: size, dir: unit(dev) };
      return [];
    }
    const along = swingDeg(dev, this.swing.dir);
    this.track(along);
    if (along > this.swing.peak) this.swing = { ...this.swing, peak: along };
    if (t - this.swing.startT > MAX_JACK_MS) return this.endSwing(t, REASON_TOO_SLOW);
    if (along > RETURN_FRACTION_JACK * this.swing.peak) return [];

    const swing = this.swing;
    const reason = (this.gyroTwoSided() ? REASON_WAVING : null) ?? this.judge(swing.startT, t);
    if (reason) return this.endSwing(t, reason);
    const entry = { dev: swing.dir, peak: swing.peak, gyroPeak: this.gyroPeak() };
    const previous = this.calibration.at(-1);
    if (previous && dot(unit(previous.dev), swing.dir) < 0.5) {
      this.calibration = [entry]; // went the other way: waving
      return this.endSwing(t, REASON_WAVING);
    }
    this.calibration = [...this.calibration, entry];
    this.endSwing(t, null);
    if (this.calibration.length < CALIBRATION_JACKS) return [];

    this.direction = unit(this.calibration.reduce<Vec3>((sum, c) => [sum[0] + c.dev[0], sum[1] + c.dev[1], sum[2] + c.dev[2]], [0, 0, 0]));
    this.depth = this.calibration.reduce((sum, c) => sum + c.peak, 0) / this.calibration.length;
    const gyroPeaks = this.calibration.flatMap((c) => (c.gyroPeak === null ? [] : [c.gyroPeak]));
    this.gyroDepth = gyroPeaks.length === this.calibration.length ? gyroPeaks.reduce((a, b) => a + b, 0) / gyroPeaks.length : null;
    return Array.from({ length: CALIBRATION_JACKS }, () => {
      this.reps += 1;
      return { type: 'rep', count: this.reps } as const;
    });
  }

  /** After calibration: signed swings along the learned direction. */
  private countSwing(dev: Vec3, t: number): VerifierEvent[] {
    const depth = this.depth as number;
    const s = swingDeg(dev, this.direction as Vec3);
    this.track(s / depth);
    this.opposite = Math.min(this.opposite, s);

    if (!this.swing) {
      if (s >= START_FRACTION * depth) this.swing = { startT: this.restT, peak: s, dir: this.direction as Vec3 };
      else if (s <= RETURN_FRACTION_JACK * depth) this.restT = t;
      return [];
    }
    if (s > this.swing.peak) this.swing = { ...this.swing, peak: s };
    if (t - this.swing.startT > MAX_JACK_MS) return this.endSwing(t, REASON_TOO_SLOW);
    if (s > RETURN_FRACTION_JACK * depth) return [];

    const swing = this.swing;
    const reason =
      (this.opposite < -OPPOSITE_FRACTION * depth || this.gyroTwoSided() ? REASON_WAVING : null) ??
      this.judge(swing.startT, t) ??
      (this.deepEnough(swing.peak) ? null : REASON_NOT_DEEP_ENOUGH);
    if (reason) return this.endSwing(t, reason);
    this.endSwing(t, null);
    this.reps += 1;
    return [{ type: 'rep', count: this.reps }];
  }

  /** Timing only. (No shaking check: shaking cannot tilt the phone through a calibrated swing,
   * and MIN_JACK_MS already caps the rate at ~2 Hz.) */
  private judge(startT: number, endT: number): string | null {
    const duration = endT - startT;
    if (duration < MIN_JACK_MS) return REASON_TOO_FAST;
    if (duration > MAX_JACK_MS) return REASON_TOO_SLOW;
    return null;
  }

  /** Closes the current swing; with a reason it is a rejection. */
  private endSwing(t: number, reason: string | null): VerifierEvent[] {
    this.swing = null;
    this.restT = t;
    this.opposite = 0;
    this.thetas = [];
    this.thetaTimes = [];
    // An accepted swing ends with the arm back down: re-zero the gyro angle there (bounds bias
    // drift). A rejected one does not, so waving stays measured from the true rest.
    if (!reason) {
      this.theta = [0, 0, 0];
      return [];
    }
    this.debug = { ...this.debug, lastReason: reason };
    return [{ type: 'rep.rejected', reason }];
  }

  private track(progress: number): void {
    this.debug = { ...this.debug, calibrated: this.depth !== null, progress, depth: this.depth ?? undefined };
  }

  /** Integrates rotationRate (deg/s) into the swing angle; zero at rest. No-op without gyro data. */
  private integrateRotation({ rx, ry, rz }: Reading, t: number, dt: number, resting: boolean): void {
    if (resting) this.theta = [0, 0, 0];
    if (rx === undefined || ry === undefined || rz === undefined) return;
    this.theta = [this.theta[0] + rx * dt, this.theta[1] + ry * dt, this.theta[2] + rz * dt];
    const keep = this.thetaTimes.findIndex((s) => t - s <= GYRO_BUFFER_MS);
    const from = keep < 0 ? this.thetas.length : keep;
    this.thetas = [...this.thetas.slice(from), this.theta];
    this.thetaTimes = [...this.thetaTimes.slice(from), t];
  }

  /** Largest gyro swing angle (deg) since the last swing; null without gyro data. */
  private gyroPeak(): number | null {
    return this.thetas.length === 0 ? null : Math.max(...this.thetas.map(length));
  }

  /**
   * Reached DEEP_FRACTION of the calibrated swing? By gyro angle when both have it (the accel
   * direction under-reads big arm swings — the arm's own acceleration skews it at the top).
   */
  private deepEnough(accelPeak: number): boolean {
    const gyroPeak = this.gyroPeak();
    if (this.gyroDepth !== null && gyroPeak !== null) return gyroPeak >= DEEP_FRACTION * this.gyroDepth;
    return accelPeak >= DEEP_FRACTION * (this.depth as number);
  }

  /** Since the last swing, did the gyro angle swing to both sides of rest (waving)? */
  private gyroTwoSided(): boolean {
    if (this.thetas.length === 0) return false;
    const widest = this.thetas.reduce((best, th) => (length(th) > length(best) ? th : best));
    if (length(widest) < GYRO_MIN_SWING_DEG) return false;
    const axis = unit(widest);
    const along = this.thetas.map((th) => dot(th, axis));
    const out = Math.max(...along);
    const back = -Math.min(...along);
    return back >= GYRO_TWO_SIDED_FRACTION * out;
  }

  /** Held still for REST_MS: every direction in that span within REST_CHORD of the current one. */
  private isResting(t: number, direction: Vec3): boolean {
    this.recent = [...this.recent.filter((r) => t - r.t <= REST_MS), { t, dir: direction }];
    if (t - this.recent[0].t < REST_MS * 0.9) return false;
    return this.recent.every((r) => length(sub(r.dir, direction)) < REST_CHORD);
  }

  private restart(): void {
    this.filters.forEach((f) => f.reset());
    this.recent = [];
    this.theta = [0, 0, 0];
    this.thetas = [];
    this.thetaTimes = [];
    this.lowPass = null;
    this.rest = null;
    this.swing = null;
    this.opposite = 0;
  }
}
