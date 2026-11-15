/**
 * Accelerometer rep counter for the phone (armband/pocket) and Watch: squat, jumping jack,
 * sit-up, arm push-up. (The Home Base pad has its own counter — padPushup.ts.)
 *
 * Signal (verticalMotion.ts): gravity is low-passed out of accelerationIncludingGravity and only
 * the acceleration ALONG gravity is integrated into a vertical displacement proxy. Tilting or
 * waving the phone sideways moves no body up or down, so it is not a rep.
 *
 * Cycles: the first clear excursion sets the direction the exercise starts in (squat: down,
 * sit-up with an armband: up). A cycle = top → leave by ≥ START → far point → back ≥
 * RETURN_FRACTION → the next top. Its time is top to top (the full down→up cycle); its depth is
 * the mean of the way out and the way back, so slow drift between tops cancels.
 *
 * Every finished cycle is judged, in this order — the first failure is the rep.rejected reason:
 *   1. rotationRate peak > ROTATION_MAX_DPS → 'phone tumbling' (waving / tossing the phone;
 *      skipped when the source sends no gyro data)
 *   2. dominant frequency of vertical accel > SHAKE_MAX_HZ → 'shaking'
 *   3. cycle time (top to top) outside MIN_REP_MS…MAX_REP_MS, or the way down alone longer than
 *      MAX_REP_MS / 2 → 'too fast' / 'too slow'
 *   4. depth < DEEP_FRACTION of the calibrated depth → 'not deep enough'
 * A cycle still out after MAX_REP_MS, or interrupted by the phone settling at a new angle (or an
 * impossible integrated speed), is abandoned and judged the same way — never a rep.
 *
 * Calibration: the first 2 cycles that pass 1–3 and reach CAL_MIN_M set the depth (their mean)
 * and both count. Calibration survives a source restart (t going backwards).
 */
import type { Reading } from '../../lib/schemas';
import { MedianFilter } from './smoothing';
import type { RepDebug } from './repDebug';
import type { Verifier, VerifierEvent } from './types';
import { VerticalMotionTracker, dominantFrequencyHz, type Vec3 } from './verticalMotion';

export const ACCEL_EXERCISES = ['squat', 'jumpingjack', 'situp', 'armPushup'] as const;
export type AccelExercise = (typeof ACCEL_EXERCISES)[number];

export const CALIBRATION_REPS = 2;
/** Smallest vertical excursion (displacement proxy, m) that counts as a calibration rep. */
export const CAL_MIN_M = 0.12;
/** A cycle starts this far (fraction of calibrated depth) from home… */
export const START_FRACTION = 0.35;
/** …is on its way back once it has returned this fraction of the way… */
export const RETURN_FRACTION = 0.5;
/** …and ends at the next top: d turns up by this fraction of the start level, or holds for SETTLE_MS. */
export const TURN_FRACTION = 0.3;
export const SETTLE_MS = 400;
/** A rep must reach this fraction of the calibrated depth. */
export const DEEP_FRACTION = 0.7;
export const MIN_REP_MS = 800;
export const MAX_REP_MS = 4_000;
/**
 * Peak rotation rate (deg/s) during a rep; above this the phone is being waved, not worn.
 * Per exercise: jumping jacks swing the arm overhead at 300–500 °/s, as fast as waving, so they
 * use their own counter (jackReps.ts) that tells waving apart by which side of rest it swings to.
 */
export const ROTATION_MAX_DPS = 240;
export const ROTATION_LIMITS_DPS: Record<AccelExercise, number> = {
  squat: ROTATION_MAX_DPS,
  situp: ROTATION_MAX_DPS,
  armPushup: ROTATION_MAX_DPS,
  jumpingjack: Number.POSITIVE_INFINITY, // see jackReps.ts — not counted by this class
};
/** Dominant vertical-accel frequency (Hz) above which the motion is shaking, not a rep. */
export const SHAKE_MAX_HZ = 2.5;

export const REASON_NOT_DEEP_ENOUGH = 'not deep enough';
export const REASON_TOO_FAST = 'too fast';
export const REASON_TOO_SLOW = 'too slow';
export const REASON_TUMBLING = 'phone tumbling';
export const REASON_SHAKING = 'shaking';

/** Samples kept for judging a cycle (a little more than the longest allowed one). */
const BUFFER_MS = MAX_REP_MS + 1_000;

interface Sample {
  t: number;
  aUp: number;
  /** |rotationRate|, deg/s; undefined when the source sends no gyro data. */
  rot?: number;
}

/**
 * Where the current cycle is, in d = displacement along the exercise's starting direction:
 * home (top, d at its lowest) → out (d rising to `far`) → back (falling to a new top `low`).
 */
type Phase =
  | { kind: 'home'; home: number; homeT: number }
  | { kind: 'out'; home: number; homeT: number; far: number; farT: number }
  | { kind: 'back'; home: number; homeT: number; far: number; farT: number; low: number; lowT: number };

/** When a cycle left the top, reached its far point (if it did), and got back to the top. */
interface CycleTimes {
  startT: number;
  bottomT?: number;
  endT: number;
}

export class AccelRepCounter implements Verifier {
  private reps = 0;
  private readonly accelFilters = [new MedianFilter(), new MedianFilter(), new MedianFilter()];
  private readonly rotFilter = new MedianFilter();
  private readonly tracker = new VerticalMotionTracker();
  private buffer: Sample[] = [];
  private phase: Phase | null = null;
  /** +1: the exercise starts by moving up; −1: by moving down. Null until the first excursion. */
  private direction: 1 | -1 | null = null;
  private calibrationDepths: number[] = [];
  private depth: number | null = null;
  private lastT: number | null = null;
  private debug: RepDebug = { calibrated: false, progress: 0 };

  constructor(readonly exercise: AccelExercise) {}

  get debugState(): RepDebug {
    return this.debug;
  }

  get count(): number {
    return this.reps;
  }

  get isCalibrated(): boolean {
    return this.depth !== null;
  }

  push(reading: Reading): VerifierEvent[] {
    const { ax, ay, az, t } = reading;
    if (ax === undefined || ay === undefined || az === undefined) return [];
    if (this.lastT !== null && t < this.lastT) this.restart();
    this.lastT = t;

    const accel = [ax, ay, az].map((v, i) => this.accelFilters[i].push(v)) as unknown as Vec3;
    const { aUp, x, still, untrusted } = this.tracker.push(t, accel);
    const rot = rotationMagnitude(reading);
    const sample: Sample = { t, aUp, rot: rot === undefined ? undefined : this.rotFilter.push(rot) };
    this.buffer = [...this.buffer.filter((s) => t - s.t <= BUFFER_MS), sample];
    const events = untrusted ? this.abandonInProgress(t) : this.step(x, t, still);
    this.rezeroIfResting(still, t);
    this.updateDebug(x, sample.rot);
    return events;
  }

  private updateDebug(x: number, rotDps: number | undefined): void {
    const phase = this.phase;
    const away = phase && phase.kind !== 'home' && this.direction ? x * this.direction - phase.home : 0;
    this.debug = {
      ...this.debug,
      calibrated: this.depth !== null,
      progress: this.depth ? away / this.depth : away,
      depth: this.depth ?? undefined,
      rotDps,
    };
  }

  private step(x: number, t: number, still: boolean): VerifierEvent[] {
    if (this.direction === null) {
      if (Math.abs(x) < this.startLevel()) return [];
      this.direction = x > 0 ? 1 : -1;
      this.phase = { kind: 'home', home: 0, homeT: this.phase?.homeT ?? t };
    }
    const d = x * this.direction;
    const phase: Phase = this.phase ?? { kind: 'home', home: d, homeT: t };

    switch (phase.kind) {
      case 'home':
        this.phase = this.stepHome(phase, d, t);
        return [];
      case 'out':
        return this.stepOut(phase, d, t);
      case 'back':
        return this.stepBack(phase, d, t, still);
    }
  }

  /** The motion since the last rest was the phone moving, not the body: drop any rep in progress. */
  private abandonInProgress(t: number): VerifierEvent[] {
    const phase = this.phase;
    if (!phase || phase.kind === 'home') {
      this.tracker.resetDisplacement();
      return [];
    }
    return this.abandonCycle(phase.homeT, t);
  }

  /** Still between reps: this spot is the new zero, and the next rep starts no earlier than now. */
  private rezeroIfResting(still: boolean, t: number): void {
    if (!still || (this.phase !== null && this.phase.kind !== 'home')) return;
    this.tracker.resetDisplacement();
    this.phase = { kind: 'home', home: 0, homeT: t };
  }

  private stepHome(phase: Extract<Phase, { kind: 'home' }>, d: number, t: number): Phase {
    if (d < phase.home) return { kind: 'home', home: d, homeT: t };
    if (d - phase.home >= this.startLevel()) {
      return { kind: 'out', home: phase.home, homeT: phase.homeT, far: d, farT: t };
    }
    return phase;
  }

  private stepOut(phase: Extract<Phase, { kind: 'out' }>, d: number, t: number): VerifierEvent[] {
    if (t - phase.homeT > MAX_REP_MS) return this.abandonCycle(phase.homeT, t);
    const out = d > phase.far ? { ...phase, far: d, farT: t } : phase;
    this.phase =
      out.far - d >= RETURN_FRACTION * (out.far - out.home) ? { ...out, kind: 'back', low: d, lowT: t } : out;
    return [];
  }

  /** Coming back: the cycle ends at the new top — d turns up again, holds for SETTLE_MS, or the body is still. */
  private stepBack(phase: Extract<Phase, { kind: 'back' }>, d: number, t: number, still: boolean): VerifierEvent[] {
    const low = Math.min(phase.low, d);
    const lowT = d < phase.low ? t : phase.lowT;
    const turned = d - low >= TURN_FRACTION * this.startLevel();
    if (!turned && !still && t - lowT < SETTLE_MS) {
      if (t - phase.homeT > MAX_REP_MS + SETTLE_MS) return this.abandonCycle(phase.homeT, t);
      this.phase = { ...phase, low, lowT };
      return [];
    }
    // Drift tilts descent vs ascent in opposite directions; their mean cancels it.
    const depth = (phase.far - phase.home + (phase.far - low)) / 2;
    this.phase = this.stepHome({ kind: 'home', home: low, homeT: lowT }, d, t);
    return this.finishCycle(depth, { startT: phase.homeT, bottomT: phase.farT, endT: lowT });
  }

  private finishCycle(excursion: number, cycle: CycleTimes): VerifierEvent[] {
    const reason = this.judge(cycle) ?? this.depthReason(excursion);
    if (reason) return this.reject(reason);
    if (this.depth !== null) {
      this.reps += 1;
      return [{ type: 'rep', count: this.reps }];
    }
    this.calibrationDepths = [...this.calibrationDepths, excursion];
    if (this.calibrationDepths.length < CALIBRATION_REPS) return [];
    this.depth = this.calibrationDepths.reduce((sum, v) => sum + v, 0) / this.calibrationDepths.length;
    return Array.from({ length: CALIBRATION_REPS }, () => {
      this.reps += 1;
      return { type: 'rep', count: this.reps } as const;
    });
  }

  /** Gives up on the cycle in progress (never a rep) and starts afresh from here. */
  private abandonCycle(startT: number, t: number): VerifierEvent[] {
    this.tracker.resetDisplacement();
    this.phase = { kind: 'home', home: 0, homeT: t };
    return this.reject(this.judge({ startT, endT: t }) ?? REASON_TOO_SLOW);
  }

  private reject(reason: string): VerifierEvent[] {
    // Before any calibration rep is accepted, the next excursion may pick the direction afresh.
    if (this.depth === null && this.calibrationDepths.length === 0) {
      this.direction = null;
      this.tracker.resetDisplacement();
      this.phase = { kind: 'home', home: 0, homeT: this.lastT ?? 0 };
    }
    this.debug = { ...this.debug, lastReason: reason };
    return [{ type: 'rep.rejected', reason }];
  }

  /** Rotation, shaking and timing checks over the cycle. Null = passes. */
  private judge({ startT, bottomT, endT }: CycleTimes): string | null {
    const window = this.buffer.filter((s) => s.t >= startT && s.t <= endT);
    const rotations = window.flatMap((s) => (s.rot === undefined ? [] : [s.rot]));
    if (rotations.length > 0 && Math.max(...rotations) > ROTATION_LIMITS_DPS[this.exercise]) return REASON_TUMBLING;
    if (dominantFrequencyHz(window.map((s) => ({ t: s.t, v: s.aUp }))) > SHAKE_MAX_HZ) return REASON_SHAKING;
    const duration = endT - startT;
    if (duration < MIN_REP_MS) return REASON_TOO_FAST;
    // The way down alone shows a too-slow rep even when the slow way up is too gentle to measure.
    if (duration > MAX_REP_MS || (bottomT !== undefined && bottomT - startT > MAX_REP_MS / 2)) return REASON_TOO_SLOW;
    return null;
  }

  private depthReason(excursion: number): string | null {
    if (this.depth === null) return excursion >= CAL_MIN_M ? null : REASON_NOT_DEEP_ENOUGH;
    return excursion >= DEEP_FRACTION * this.depth ? null : REASON_NOT_DEEP_ENOUGH;
  }

  private startLevel(): number {
    return this.depth === null ? CAL_MIN_M : START_FRACTION * this.depth;
  }

  /** The source restarted: drop motion state, keep calibration and direction. */
  private restart(): void {
    this.tracker.reset();
    this.accelFilters.forEach((f) => f.reset());
    this.rotFilter.reset();
    this.buffer = [];
    this.phase = null;
  }
}

function rotationMagnitude({ rx, ry, rz }: Reading): number | undefined {
  if (rx === undefined && ry === undefined && rz === undefined) return undefined;
  return Math.hypot(rx ?? 0, ry ?? 0, rz ?? 0);
}
