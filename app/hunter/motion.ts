/**
 * Pure helpers for the phone sensor: DeviceMotion sample → Reading, ~30 Hz downsampling and
 * batch sizing. No browser APIs here, so it is unit-tested.
 */
import type { Reading } from '../../lib/schemas';

export const STANDARD_GRAVITY = 9.80665; // m/s² per g
export const SAMPLE_INTERVAL_MS = 1000 / 30; // ~30 Hz
export const FLUSH_INTERVAL_MS = 200;
/** /api/readings accepts at most 50 per batch. */
export const MAX_BATCH = 50;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface MotionSample {
  x: number | null;
  y: number | null;
  z: number | null;
}

/** accelerationIncludingGravity (m/s²) → a phone Reading in g. Null when the sample is empty. */
export function toReading(accel: MotionSample | null, tMs: number): Reading | null {
  if (!accel || accel.x === null || accel.y === null || accel.z === null) return null;
  return {
    t: Math.max(0, Math.round(tMs)),
    source: 'phone',
    ax: round3(accel.x / STANDARD_GRAVITY),
    ay: round3(accel.y / STANDARD_GRAVITY),
    az: round3(accel.z / STANDARD_GRAVITY),
  };
}

/** True if enough time passed since the last kept sample (devicemotion fires at ~60 Hz). */
export function shouldKeep(lastKeptMs: number | null, nowMs: number): boolean {
  return lastKeptMs === null || nowMs - lastKeptMs >= SAMPLE_INTERVAL_MS - 1;
}

/** Splits queued readings into a batch to send now and the rest (oldest dropped if way behind). */
export function takeBatch(queue: readonly Reading[]): { batch: Reading[]; rest: Reading[] } {
  const recent = queue.slice(-MAX_BATCH * 2); // offline for a while? keep only the last ~3 s
  return { batch: recent.slice(0, MAX_BATCH), rest: recent.slice(MAX_BATCH) };
}

/** Where a batch goes: the focused vow's sessionId makes the server count it toward that vow. */
export function readingsUrl(sessionId: string | undefined): string {
  return sessionId ? `/api/readings?sessionId=${encodeURIComponent(sessionId)}` : '/api/readings';
}
