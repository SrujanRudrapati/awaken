/**
 * Pure sleep math (no I/O): Apple Watch samples → nights → vow verdicts.
 *
 * Night = a sleep SESSION (samples with gaps < 90 min) that starts between 18:00 and 06:00 local;
 * it belongs to the evening's date. Stages after 06:00 in that session still count (late wake-ups).
 * Asleep stages: Core, Deep, REM, Asleep (unspecified). Overlapping samples (iPhone + Watch)
 * are merged, so minutes are never double counted. Bedtime = start of the first asleep
 * sample; wake = end of the last; awakenings = Awake samples between them.
 */
import type { NightSummary, SleepSample, SleepStage } from '../lib/schemas';

const MINUTE = 60_000;
export const NIGHT_START_HOUR = 18;
export const NIGHT_END_HOUR = 6;
const ASLEEP: readonly SleepStage[] = ['Core', 'Deep', 'REM', 'Asleep'];
/** Bedtime vow: within ± this many minutes of the target. */
export const BEDTIME_WINDOW_MIN = 30;
/** Deep-sleep bonus: +BONUS_PER_STEP Proof per DEEP_STEP_MIN above baseline, at most MAX_DEEP_BONUS. */
export const DEEP_STEP_MIN = 10;
export const BONUS_PER_STEP = 5;
export const MAX_DEEP_BONUS = 25;
/** Nights needed before a personal deep-sleep baseline exists. */
export const MIN_BASELINE_NIGHTS = 3;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The evening date a sample belongs to, or null if it starts during the day (nap). */
export function nightOf(start: Date): string | null {
  const hour = start.getHours();
  if (hour >= NIGHT_START_HOUR) return localDate(start);
  if (hour < NIGHT_END_HOUR) return localDate(new Date(start.getTime() - 24 * 60 * MINUTE));
  return null;
}

type Interval = [number, number];

function mergedMinutes(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: Interval | null = null;
  for (const [s, e] of sorted) {
    if (current && s <= current[1]) current = [current[0], Math.max(current[1], e)];
    else {
      if (current) total += current[1] - current[0];
      current = [s, e];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total / MINUTE);
}

const intervalsOf = (samples: readonly SleepSample[], stages: readonly SleepStage[]): Interval[] =>
  samples.filter((s) => stages.includes(s.stage)).map((s) => [s.start.getTime(), s.end.getTime()]);

function summarizeNight(night: string, samples: readonly SleepSample[]): NightSummary | null {
  const asleep = samples.filter((s) => ASLEEP.includes(s.stage));
  if (asleep.length === 0) return null;
  const bedtime = Math.min(...asleep.map((s) => s.start.getTime()));
  const wake = Math.max(...asleep.map((s) => s.end.getTime()));
  return {
    night,
    bedtime: new Date(bedtime).toISOString(),
    wake: new Date(wake).toISOString(),
    asleepMinutes: mergedMinutes(intervalsOf(samples, ASLEEP)),
    deepMinutes: mergedMinutes(intervalsOf(samples, ['Deep'])),
    remMinutes: mergedMinutes(intervalsOf(samples, ['REM'])),
    coreMinutes: mergedMinutes(intervalsOf(samples, ['Core'])),
    awakenings: samples.filter((s) => s.stage === 'Awake' && s.start.getTime() > bedtime && s.end.getTime() < wake).length,
    inBedMinutes: mergedMinutes(intervalsOf(samples, ['InBed'])),
  };
}

/** Samples closer than this belong to one sleep session. */
export const SESSION_GAP_MIN = 90;

/** Contiguous sessions (sorted by start). */
function sessions(samples: readonly SleepSample[]): SleepSample[][] {
  const sorted = [...samples].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: SleepSample[][] = [];
  let end = -Infinity;
  for (const s of sorted) {
    if (s.start.getTime() > end + SESSION_GAP_MIN * MINUTE) result.push([]);
    result[result.length - 1].push(s);
    end = Math.max(end, s.end.getTime());
  }
  return result;
}

/** Nights, newest first. A session's night is decided by when it starts (daytime naps are ignored). */
export function summarizeNights(samples: readonly SleepSample[]): NightSummary[] {
  const byNight = new Map<string, SleepSample[]>();
  for (const session of sessions(samples)) {
    const night = nightOf(session[0].start);
    if (night) byNight.set(night, [...(byNight.get(night) ?? []), ...session]);
  }
  return [...byNight.entries()]
    .map(([night, list]) => summarizeNight(night, list))
    .filter((n): n is NightSummary => n !== null)
    .sort((a, b) => b.night.localeCompare(a.night));
}

/** Minutes of `time` after 18:00 on its evening (so 23:30 → 330, 00:30 → 390). */
export function minutesAfterEvening(time: Date): number {
  const minutes = time.getHours() * 60 + time.getMinutes();
  return minutes >= NIGHT_START_HOUR * 60 ? minutes - NIGHT_START_HOUR * 60 : minutes + (24 - NIGHT_START_HOUR) * 60;
}

/** "HH:MM" → minutes after 18:00 (a 01:00 target is later than a 23:00 one). */
export function targetAfterEvening(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return minutesAfterEvening(date);
}

/** "Lights out by HH:MM": asleep no later than the target. */
export function lightsOutKept(night: NightSummary, targetTime: string): boolean {
  return minutesAfterEvening(new Date(night.bedtime)) <= targetAfterEvening(targetTime);
}

/** "Bedtime HH:MM ± 30 min". */
export function bedtimeKept(night: NightSummary, targetTime: string): boolean {
  return Math.abs(minutesAfterEvening(new Date(night.bedtime)) - targetAfterEvening(targetTime)) <= BEDTIME_WINDOW_MIN;
}

/** Median deep minutes of earlier nights; null until MIN_BASELINE_NIGHTS exist. */
export function deepBaseline(previousNights: readonly NightSummary[]): number | null {
  if (previousNights.length < MIN_BASELINE_NIGHTS) return null;
  const sorted = previousNights.map((n) => n.deepMinutes).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Bonus Proof for deep sleep above the personal baseline. */
export function deepBonus(night: NightSummary, baseline: number | null): number {
  if (baseline === null || night.deepMinutes <= baseline) return 0;
  return Math.min(MAX_DEEP_BONUS, Math.floor((night.deepMinutes - baseline) / DEEP_STEP_MIN) * BONUS_PER_STEP);
}

/** "HH:MM" local clock text for a timestamp. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function hoursText(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Plain facts for Iris (and the designer). */
export function nightFacts(night: NightSummary): string {
  return `Last night: asleep ${clockTime(night.bedtime)}–${clockTime(night.wake)}, ${hoursText(night.asleepMinutes)} total; deep ${night.deepMinutes} min, REM ${night.remMinutes} min, core ${night.coreMinutes} min; ${night.awakenings} awakening${night.awakenings === 1 ? '' : 's'}.`;
}
