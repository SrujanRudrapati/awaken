/** What the Reckoning screen shows (pure, unit-tested). */
import type { Quest } from '../../lib/schemas';

/** The Reckoning vow still owed, if any (the one that runs out first). */
export function reckoningVow(vows: readonly Quest[]): Quest | null {
  const owed = vows.filter((vow) => vow.kind === 'penalty' && vow.status === 'active');
  return [...owed].sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))[0] ?? null;
}

/** "01:59:42" until the deadline; "00:00:00" once past. */
export function countdown(deadlineIso: string, nowMs: number): string {
  const left = Math.max(0, Math.floor((Date.parse(deadlineIso) - nowMs) / 1000));
  return [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((part) => String(part).padStart(2, '0')).join(':');
}
