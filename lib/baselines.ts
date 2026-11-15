/**
 * Personal baselines from the latest Calibration (memory first, then Tiger `calibrations`).
 * Kept here — not in engine/calibration — so the quest engine can scale Proof without a cycle.
 */
import * as db from './db';
import type { Baselines } from './power';

/** Give up on Tiger after this long: a vow's reward must not wait on venue Wi-Fi. */
const LOOKUP_TIMEOUT_MS = 500;

/** `null` = looked up, no calibration on record (cached too, so uncalibrated players don't hit the DB each vow). */
const globalForBaselines = globalThis as typeof globalThis & { __awakenBaselines?: Map<string, Baselines | null> };
function store(): Map<string, Baselines | null> {
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

const TIMED_OUT = Symbol('timed-out');

async function lookup(playerId: string): Promise<Baselines | null | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), LOOKUP_TIMEOUT_MS);
  });
  try {
    const read = db.latestCalibration(playerId).then((latest) => (latest ? fromResult(latest.result) : null));
    return await Promise.race([read, timeout]);
  } catch {
    return TIMED_OUT; // DB error: unknown, try again next time
  } finally {
    clearTimeout(timer);
  }
}

export async function getBaselines(playerId: string): Promise<Baselines | null> {
  if (store().has(playerId)) return store().get(playerId) ?? null;
  const found = await lookup(playerId);
  if (found === TIMED_OUT) return null; // not cached: Tiger may answer next time
  if (!store().has(playerId)) store().set(playerId, found); // a calibration meanwhile wins
  return store().get(playerId) ?? null;
}

/** Forgets matching baselines (demo reset). */
export function forgetBaselines(shouldForget: (playerId: string) => boolean): void {
  [...store().keys()].filter(shouldForget).forEach((id) => store().delete(id));
}

/** Test hook. */
export function resetBaselines(): void {
  globalForBaselines.__awakenBaselines = undefined;
}
