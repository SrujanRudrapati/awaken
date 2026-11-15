/**
 * Remembers when the Home Base light sensor saw a dark room (per minute, last 36 h) so a
 * "Lights out by HH:MM" vow kept on the Watch can get an extra confirmation from the room.
 */
import type { Reading } from './schemas';

/** Light (0–1023) at or below this counts as a dark room. */
export const DARK_LIGHT = 80;
export const CONFIRM_WINDOW_MIN = 15;
const KEEP_MS = 36 * 60 * 60_000;
const MINUTE = 60_000;

const globalForLight = globalThis as typeof globalThis & { __awakenDarkMinutes?: Set<number> };

function darkMinutes(): Set<number> {
  globalForLight.__awakenDarkMinutes ??= new Set();
  return globalForLight.__awakenDarkMinutes;
}

/** Call with every Home Base reading (wall-clock time = when it arrived). */
export function recordLight(reading: Reading, now = Date.now()): void {
  if (reading.source !== 'homebase' || reading.light === undefined || reading.light > DARK_LIGHT) return;
  const minutes = darkMinutes();
  minutes.add(Math.floor(now / MINUTE));
  if (minutes.size % 60 === 0) {
    const oldest = Math.floor((now - KEEP_MS) / MINUTE);
    for (const m of minutes) if (m < oldest) minutes.delete(m);
  }
}

/** Was the room dark at any minute within ± CONFIRM_WINDOW_MIN of `time`? */
export function wasDarkNear(time: Date): boolean {
  const center = Math.floor(time.getTime() / MINUTE);
  for (let m = center - CONFIRM_WINDOW_MIN; m <= center + CONFIRM_WINDOW_MIN; m += 1) if (darkMinutes().has(m)) return true;
  return false;
}

/** Test hook. */
export function resetLightHistory(): void {
  globalForLight.__awakenDarkMinutes = undefined;
}
