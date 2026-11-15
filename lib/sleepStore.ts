/**
 * Sleep samples per person: in memory (always) + Tiger `sleep_samples` (when configured).
 * Idempotent — a sample is identified by start + end + stage, so the Shortcut can resend a
 * whole day without double counting.
 */
import * as db from './db';
import { SleepStageSchema, type SleepSample } from './schemas';

const globalForSleep = globalThis as typeof globalThis & { __awakenSleep?: Map<string, Map<string, SleepSample>> };

function store(): Map<string, Map<string, SleepSample>> {
  globalForSleep.__awakenSleep ??= new Map();
  return globalForSleep.__awakenSleep;
}

export function sampleKey(s: SleepSample): string {
  return `${s.start.toISOString()}|${s.end.toISOString()}|${s.stage}`;
}

function bucket(playerId: string): Map<string, SleepSample> {
  const existing = store().get(playerId);
  if (existing) return existing;
  const created = new Map<string, SleepSample>();
  store().set(playerId, created);
  return created;
}

/** Adds samples; returns how many were new (in memory). Persists to Tiger in the background. */
export function addSleepSamples(playerId: string, samples: readonly SleepSample[]): number {
  const mine = bucket(playerId);
  const fresh = samples.filter((s) => !mine.has(sampleKey(s)));
  for (const s of fresh) mine.set(sampleKey(s), s);
  db.insertSleepSamples(playerId, fresh).catch((error: unknown) =>
    console.error('[sleep] persist failed:', error instanceof Error ? error.message : error),
  );
  return fresh.length;
}

/** Samples starting at or after `since`: memory merged with Tiger (Tiger fills a restarted server). */
export async function listSleepSamples(playerId: string, since: Date): Promise<SleepSample[]> {
  const mine = bucket(playerId);
  const stored = await db.listSleepSamples(playerId, since).catch(() => null);
  for (const row of stored ?? []) {
    const stage = SleepStageSchema.safeParse(row.stage);
    if (!stage.success) continue;
    const sample = { start: row.start, end: row.end, stage: stage.data };
    if (!mine.has(sampleKey(sample))) mine.set(sampleKey(sample), sample);
  }
  return [...mine.values()].filter((s) => s.start >= since).sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Test hook. */
export function resetSleepStore(): void {
  globalForSleep.__awakenSleep = undefined;
}
