/**
 * Vertical motion from a phone/Watch accelerometer (accelerationIncludingGravity, in g).
 *
 * 1. Gravity: a low-pass of the raw vector — its mean over each still moment, held while moving
 *    (so a rep never leaks into its own reference). Its direction is "up" for the specific force
 *    the sensor measures, whatever the device's sign convention (iOS and the W3C spec differ —
 *    the projection a·ĝ is the same either way).
 * 2. Vertical linear acceleration: aUp = a·ĝ − |g| (g, + = accelerating upward). Motion
 *    sideways adds nothing.
 * 3. Displacement proxy: aUp → velocity → displacement, both leaky (band-passed). Velocity is
 *    zeroed whenever the device is still (quiet accel AND low speed — the middle of a slow squat
 *    is quiet too); the caller re-zeroes displacement between reps. Read it relatively
 *    (top → bottom → top), never as an absolute height.
 *
 * The output is a proxy, not metres you can trust absolutely: thresholds downstream are
 * relative to the player's calibrated depth.
 */

export const STANDARD_GRAVITY = 9.80665; // m/s² per g
/**
 * Leak of both integrators (a band-pass): a small gravity-estimate bias cannot build up speed or
 * height. The price is an overshoot after each rep, which the rep detector cancels by averaging
 * each cycle's descent and ascent.
 */
export const LEAK_TAU_S = 2.5;
/** The raw accel staying within this (g) of its running mean is steady… */
export const STILL_G = 0.025;
/** …and steady this long at ~1 g is still: velocity zeroed, gravity re-measured. */
export const STILL_MS = 250;
/** At rest the accel magnitude matches |gravity| to within this (g) — a slow rep's pull does not. */
export const STILL_NORM_G = 0.012;
/** Mid-rep of a slow squat the accel is steady too, but the body is moving — so check speed (m/s). */
export const STILL_VELOCITY = 0.1;
/** No exercise moves the body faster than this (m/s); a higher integrated speed is junk. */
export const MAX_BODY_SPEED = 2;
/**
 * Steady this long is still whatever the integrated speed says (even a 4 s squat's accel is never
 * steady for more than ~0.7 s). Still this way while "moving" faster than JUNK_SPEED = junk.
 */
export const STILL_LONG_MS = 800;
const JUNK_SPEED = 0.3;
/** Gravity re-measured this far (degrees) from the old one: the phone was re-oriented. */
export const REORIENT_DEG = 30;
/** Gaps longer than this (dropped samples, paused page) are not integrated across. */
const MAX_DT_S = 0.2;

export type Vec3 = readonly [number, number, number];

export interface VerticalSample {
  /** Vertical linear acceleration, g, + = upward. */
  aUp: number;
  /** Displacement proxy, m, + = up. */
  x: number;
  /** The device is still right now. */
  still: boolean;
  /**
   * Came to rest after motion that was not the body moving — in a new orientation, or with an
   * impossible integrated speed. Any rep in progress is not trustworthy.
   */
  untrusted: boolean;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const angleDeg = (a: Vec3, b: Vec3): number =>
  (Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (norm(a) * norm(b))))) * 180) / Math.PI;

/** Raw samples since the accel last jumped away from its running mean. */
interface SteadyWindow {
  since: number;
  sum: Vec3;
  count: number;
}

export class VerticalMotionTracker {
  private gravity: Vec3 | null = null;
  private lastT: number | null = null;
  private velocity = 0;
  private displacement = 0;
  private steady: SteadyWindow | null = null;

  push(t: number, accel: Vec3): VerticalSample {
    const dt = this.lastT === null ? 0 : Math.min(Math.max((t - this.lastT) / 1000, 0), MAX_DT_S);
    this.lastT = t;
    const gravity = this.gravity ?? accel;
    const gNorm = norm(gravity);
    const aUp = gNorm > 0 ? dot(accel, gravity) / gNorm - gNorm : 0;

    this.steady = extendSteady(this.steady, t, accel);
    const still = this.isStill(t, aUp, gravity);
    if (!still) {
      this.gravity = gravity; // frozen while moving: a rep must not leak into its own reference
      this.integrate(aUp, dt);
      return { aUp, x: this.displacement, still, untrusted: false };
    }
    const window = this.steady as SteadyWindow;
    this.gravity = scale(window.sum, 1 / window.count); // mean of the still window
    const speed = Math.abs(this.velocity);
    const untrusted =
      angleDeg(gravity, this.gravity) > REORIENT_DEG ||
      speed > MAX_BODY_SPEED ||
      (t - window.since >= STILL_LONG_MS && speed > JUNK_SPEED);
    this.velocity = 0; // zero-velocity update; displacement is held (a paused squat is still mid-rep)
    return { aUp, x: this.displacement, still, untrusted };
  }

  /** Call between reps only: the current position becomes the new zero (velocity is left to ZUPT). */
  resetDisplacement(): void {
    this.displacement = 0;
  }

  reset(): void {
    this.gravity = null;
    this.lastT = null;
    this.velocity = 0;
    this.displacement = 0;
    this.steady = null;
  }

  /**
   * Still = the raw accel has been steady for STILL_MS at about 1 g (not the bottom of a squat,
   * which is steady but heavier), and either it no longer lines up with gravity (the phone was
   * put down at a new angle), the integrated speed is ~0 (or impossibly high — junk from
   * waving), or it has been steady a long time.
   */
  private isStill(t: number, aUp: number, gravity: Vec3): boolean {
    if (!this.steady) return false;
    const steadyMs = t - this.steady.since;
    if (steadyMs < STILL_MS) return false;
    const mean = scale(this.steady.sum, 1 / this.steady.count);
    if (Math.abs(norm(mean) - norm(gravity)) >= STILL_NORM_G) return false;
    const speed = Math.abs(this.velocity);
    return Math.abs(aUp) >= STILL_G || speed < STILL_VELOCITY || speed > MAX_BODY_SPEED || steadyMs >= STILL_LONG_MS;
  }

  private integrate(aUp: number, dt: number): void {
    const leak = Math.exp(-dt / LEAK_TAU_S);
    this.velocity = this.velocity * leak + aUp * STANDARD_GRAVITY * dt;
    this.displacement = this.displacement * leak + this.velocity * dt;
  }
}

/** Extends the steady window, or starts a new one when the accel jumps away from its mean. */
function extendSteady(window: SteadyWindow | null, t: number, accel: Vec3): SteadyWindow {
  if (window) {
    const mean = scale(window.sum, 1 / window.count);
    if (norm(add(accel, scale(mean, -1))) < STILL_G) {
      return { since: window.since, sum: add(window.sum, accel), count: window.count + 1 };
    }
  }
  return { since: t, sum: accel, count: 1 };
}

/**
 * Dominant frequency (Hz) of a sampled signal: the strongest DFT bin after removing the mean.
 * Assumes roughly even sampling (uses the mean interval). 0 when there is too little data.
 */
export function dominantFrequencyHz(samples: readonly { t: number; v: number }[]): number {
  const n = samples.length;
  if (n < 4) return 0;
  const spanS = (samples[n - 1].t - samples[0].t) / 1000;
  if (spanS <= 0) return 0;
  const dtS = spanS / (n - 1);
  const mean = samples.reduce((sum, s) => sum + s.v, 0) / n;

  let best = { k: 0, power: 0 };
  for (let k = 1; k <= Math.floor(n / 2); k += 1) {
    let re = 0;
    let im = 0;
    samples.forEach((s, i) => {
      const angle = (2 * Math.PI * k * i) / n;
      re += (s.v - mean) * Math.cos(angle);
      im -= (s.v - mean) * Math.sin(angle);
    });
    const power = re * re + im * im;
    if (power > best.power) best = { k, power };
  }
  return best.k / (n * dtS);
}
