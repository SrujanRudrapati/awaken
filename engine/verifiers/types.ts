import type { DeviceCommand, Reading } from '../../lib/schemas';

/**
 * What a verifier reports. The router adds playerId/questId, publishes, and forwards
 * `device` commands to the Home Base.
 *
 * - rep / rep.rejected: rep counters (push-ups, squats…)
 * - progress: timer verifiers' new quest progress (seconds held, or 1 for lights-out)
 * - done / fail: timer verifiers decide completion or failure themselves
 * - device: a Home Base command (LOCK, UNLOCK, SEG countdown, BUZZ)
 */
export type VerifierEvent =
  | { type: 'rep'; count: number }
  | { type: 'rep.rejected'; reason: string }
  | { type: 'progress'; value: number }
  | { type: 'done' }
  | { type: 'fail'; reason: string }
  | { type: 'device'; cmd: DeviceCommand };

/** Deterministic, code-only sensor verifier. Returns events; never publishes. */
export interface Verifier {
  push(reading: Reading): VerifierEvent[];
}

/** What a verifier factory knows about the quest it verifies. */
export interface VerifierQuest {
  /** Target in the quest's unit (seconds for timers). */
  target: number;
  /** Progress already earned (a resumed quest continues from here). */
  progress: number;
}
