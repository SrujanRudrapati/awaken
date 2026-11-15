/**
 * Personal baselines from the latest Calibration (memory first, then Tiger `calibrations`).
 * Kept here — not in engine/calibration — so the quest engine can scale Proof without a cycle.
 */
import * as db from './db';
import type { Baselines } from './power';

const globalForBaselines = globalThis as typeof globalThis & { __awakenBaselines?: Map<string, Baselines> };
function store(): Map<string, Baselines> {
  globalForBaselines.__awakenBaselines ??= new Map();
  return globalForBaselines.__awakenBaselines;
}

export function setBaselines(playerId: string, baselines: Baselines): void {
  store().set(playerId, baselines);
}

function fromResult(result: Record<string, unknown>): Baselines {
  const raw = (result.baselines ?? {}) as { body?: { reps?: number }; vitality?: { jumpingJacks?: number } };
  return { bodyReps: raw.body?.reps, jumpingJacks: raw.vitality?.jumpingJacks };
}

export async function getBaselines(playerId: string): Promise<Baselines | null> {
  const cached = store().get(playerId);
  if (cached) return cached;
  try {
    const latest = await db.latestCalibration(playerId);
    if (!latest) return null;
    const baselines = fromResult(latest.result);
    store().set(playerId, baselines);
    return baselines;
  } catch {
    return null;
  }
}

/** Test hook. */
export function resetBaselines(): void {
  globalForBaselines.__awakenBaselines = undefined;
}
