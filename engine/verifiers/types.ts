import type { Reading } from '../../lib/schemas';

/** What a verifier reports. The router adds playerId/questId and publishes. */
export type VerifierEvent =
  | { type: 'rep'; count: number }
  | { type: 'rep.rejected'; reason: string };

/** Deterministic, code-only sensor verifier. Returns events; never publishes. */
export interface Verifier {
  push(reading: Reading): VerifierEvent[];
}
