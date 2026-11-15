/** Test-only helpers for verifier tests (deterministic noise, waveform utilities). */
import { SAMPLE_MS, readingAt, type Mode } from '../../bridge/simulator';
import type { Reading } from '../../lib/schemas';
import type { Verifier, VerifierEvent } from './types';

/** mulberry32 — small seeded PRNG so noisy tests are reproducible. Returns values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Appends `ms` of `mode`'s resting reading (timestamps continue) so the last rep can finish. */
export function withRest(readings: readonly Reading[], mode: Mode = 'idle', ms = 500): Reading[] {
  const lastT = readings.length > 0 ? readings[readings.length - 1].t : -SAMPLE_MS;
  const rest = Array.from({ length: ms / SAMPLE_MS }, (_, i) => ({
    ...readingAt(mode, 0),
    t: lastT + (i + 1) * SAMPLE_MS,
  }));
  return [...readings, ...rest];
}

export function feed(verifier: Verifier, readings: readonly Reading[]): VerifierEvent[] {
  return readings.flatMap((reading) => verifier.push(reading));
}
