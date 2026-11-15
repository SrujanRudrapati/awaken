/**
 * /hunter ?debug=1 — a one-line readout for tuning rep thresholds on a real phone. The phone
 * mirrors the server's verifier on the exact readings it sends (same pure code), so depth and
 * rotation update live; the last rejection reason is the server's own (from rep.rejected).
 */
import type { AccelExercise } from '../../engine/verifiers/accelReps';
import type { RepDebug } from '../../engine/verifiers/repDebug';
import type { QuestType } from '../../lib/schemas';

/** Which phone counter a vow type uses; null = not a phone rep exercise. */
export function phoneExercise(type: QuestType | undefined): AccelExercise | null {
  switch (type) {
    case 'squat':
    case 'situp':
    case 'jumpingjack':
      return type;
    case 'pushup':
      return 'armPushup';
    default:
      return null;
  }
}

/** True when the page URL asks for the debug line (`?debug=1`). */
export function isDebugSearch(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

export function formatRepDebug(input: {
  exercise: AccelExercise | null;
  snapshot: RepDebug | null;
  serverReason: string | null;
}): string {
  const { exercise, snapshot, serverReason } = input;
  const last = `last ✕ ${serverReason ?? '—'}`;
  if (!exercise || !snapshot) return `DBG · no phone rep vow · ${last}`;
  const unit = exercise === 'jumpingjack' ? '°' : 'm';
  const depth = snapshot.calibrated
    ? `depth ${pct(snapshot.progress)} of ${snapshot.depth?.toFixed(exercise === 'jumpingjack' ? 0 : 2)}${unit}`
    : `calibrating ${snapshot.progress.toFixed(2)}${unit}`;
  const rot = snapshot.rotDps === undefined ? 'rot n/a' : `rot ${Math.round(snapshot.rotDps)}°/s`;
  return `DBG ${exercise} · ${depth} · ${rot} · ${last}`;
}
