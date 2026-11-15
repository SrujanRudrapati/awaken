/**
 * Test-only synthetic phone traces, built from physics rather than hand-drawn axes:
 * the phone reads specific force = up·(1 + aVert/g) + sideways, in its own (possibly
 * rotating) frame, plus rotationRate in deg/s. ~30 Hz like /hunter.
 */
import type { Reading } from '../../lib/schemas';
import { seededRandom } from './testing';
import { STANDARD_GRAVITY, type Vec3 } from './verticalMotion';

export const PHONE_SAMPLE_MS = 1000 / 30;

/** "Up" in the phone's frame when strapped to an upper arm (tilted, not axis-aligned). */
const ARMBAND_UP: Vec3 = normalize([0.15, 0.95, 0.27]);
/** Sideways (in the plane the arm swings in), perpendicular to ARMBAND_UP. */
const ARMBAND_LATERAL: Vec3 = normalize([ARMBAND_UP[1], -ARMBAND_UP[0], 0]);

interface Frame {
  /** Vertical acceleration, m/s², + = up. */
  aVert: number;
  /** Rotation of the phone about its own z axis from the base orientation, degrees. */
  tiltDeg?: number;
  /** rotationRate (deg/s) around the phone's x, y, z. */
  rot?: Vec3;
  /** Extra non-vertical acceleration, g, in the phone frame. */
  side?: Vec3;
  /** Full specific force in world (lateral, vertical) g — overrides aVert/side (used for arm swings). */
  world?: readonly [number, number];
}

/** A stretch of motion: `ms` long, `at(tSec)` describes each instant. */
export interface Segment {
  ms: number;
  at: (tSec: number) => Frame;
}

export const rest = (ms: number): Segment => ({ ms, at: () => ({ aVert: 0 }) });

/** One squat: hips drop `depthM` and come back up over `repMs` (smooth cosine profile). */
export function squat(depthM = 0.4, repMs = 2_000): Segment {
  const w = (2 * Math.PI) / (repMs / 1000);
  return {
    ms: repMs,
    at: (t) => ({
      aVert: -(depthM / 2) * w * w * Math.cos(w * t),
      rot: [10 * Math.sin(w * t), 5 * Math.cos(w * t), 15 * Math.sin(w * t)], // arm sways a little (zero-mean)
    }),
  };
}

/** The way down (part 0) or back up (part 1) of a squat — put a rest() between them for a pause. */
export function squatHalf(part: 0 | 1, depthM = 0.4, repMs = 2_000): Segment {
  const whole = squat(depthM, repMs);
  return { ms: repMs / 2, at: (t) => whole.at(t + (part * repMs) / 2000) };
}

/**
 * One jumping jack with the phone in an upper-arm armband: the arm swings out to `armDeg`
 * (overhead) and back, the armband `armM` from the shoulder, while the body hops twice
 * (out, in) by `hopM`. The phone rotates with the arm, so it sees gravity swing round and the
 * arm's centripetal/tangential acceleration on top.
 */
export function jack(repMs = 1_200, { armDeg = 160, armM = 0.2, hopM = 0.05 } = {}): Segment {
  const w = (2 * Math.PI) / (repMs / 1000);
  const amp = (armDeg * Math.PI) / 180 / 2;
  return {
    ms: repMs,
    at: (t) => {
      const theta = amp * (1 - Math.cos(w * t));
      const dTheta = amp * w * Math.sin(w * t);
      const ddTheta = amp * w * w * Math.cos(w * t);
      const hop = -(hopM / 2) * (2 * w) ** 2 * -Math.cos(2 * w * t); // two hops per rep
      const lateral = armM * (ddTheta * Math.cos(theta) - dTheta * dTheta * Math.sin(theta));
      const vertical = armM * (ddTheta * Math.sin(theta) + dTheta * dTheta * Math.cos(theta)) + hop;
      return {
        aVert: 0,
        tiltDeg: (theta * 180) / Math.PI,
        world: [lateral / STANDARD_GRAVITY, 1 + vertical / STANDARD_GRAVITY],
        rot: [0, 0, (dTheta * 180) / Math.PI],
      };
    },
  };
}

/** Waving the phone in the hand: it swings ±`tiltDeg` about its z axis and bobs ±`bobM`. */
export function wave(ms: number, { hz = 1.2, tiltDeg = 50, bobM = 0.2 } = {}): Segment {
  const w = 2 * Math.PI * hz;
  return {
    ms,
    at: (t) => ({
      aVert: -bobM * w * w * Math.sin(w * t),
      tiltDeg: tiltDeg * Math.sin(w * t),
      rot: [0, 0, tiltDeg * w * Math.cos(w * t)],
    }),
  };
}

/** Shaking: a fast vertical shake of `g` at `hz`, riding on a slow ±`driftM` bob. */
export function shake(ms: number, { hz = 5, g = 1.2, driftM = 0.2, driftHz = 0.5 } = {}): Segment {
  const w = 2 * Math.PI * hz;
  const wd = 2 * Math.PI * driftHz;
  return {
    ms,
    at: (t) => ({
      aVert: g * STANDARD_GRAVITY * Math.sin(w * t) - driftM * wd * wd * Math.sin(wd * t),
      rot: [30, 20, 40],
    }),
  };
}

export interface TraceOptions {
  seed?: number;
  /** Uniform accel noise, ± g. */
  noiseG?: number;
  /** Uniform rotation noise, ± deg/s. */
  noiseDps?: number;
  /** Leave out rotationRate (e.g. a Watch that only streams accel). */
  withRotation?: boolean;
  /** Constant gyro bias added to every axis, deg/s (real phones: well under 1). */
  gyroBiasDps?: number;
  startT?: number;
}

/** Renders segments into phone Readings. */
export function trace(segments: readonly Segment[], options: TraceOptions = {}): Reading[] {
  const { seed = 1, noiseG = 0.01, noiseDps = 5, withRotation = true, gyroBiasDps = 0, startT = 0 } = options;
  const random = seededRandom(seed);
  const jitter = (amp: number): number => (random() * 2 - 1) * amp;

  let offsetMs = 0;
  return segments.flatMap((segment) => {
    const count = Math.round(segment.ms / PHONE_SAMPLE_MS);
    const readings = Array.from({ length: count }, (_, i): Reading => {
      const frame = segment.at((i * PHONE_SAMPLE_MS) / 1000);
      const up = rotateZ(ARMBAND_UP, frame.tiltDeg ?? 0);
      const lateral = rotateZ(ARMBAND_LATERAL, frame.tiltDeg ?? 0);
      const [fLat, fUp] = frame.world ?? [0, 1 + frame.aVert / STANDARD_GRAVITY];
      const side = frame.side ?? [0, 0, 0];
      const [ax, ay, az] = up.map((u, k) => u * fUp + lateral[k] * fLat + side[k] + jitter(noiseG));
      const rot = frame.rot ?? [0, 0, 0];
      const reading: Reading = { t: Math.round(startT + offsetMs + i * PHONE_SAMPLE_MS), source: 'phone', ax, ay, az };
      return withRotation
        ? {
            ...reading,
            rx: rot[0] + gyroBiasDps + jitter(noiseDps),
            ry: rot[1] + gyroBiasDps + jitter(noiseDps),
            rz: rot[2] + gyroBiasDps + jitter(noiseDps),
          }
        : reading;
    });
    offsetMs += count * PHONE_SAMPLE_MS;
    return readings;
  });
}

/** n copies of a segment. */
export const times = (n: number, segment: Segment): Segment[] => Array.from({ length: n }, () => segment);

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function rotateZ(v: Vec3, deg: number): Vec3 {
  const r = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r), v[2]];
}
