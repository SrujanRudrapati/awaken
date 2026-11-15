import { describe, expect, it } from 'vitest';
import { normalizeSleepStage, parseShortcutDate, SleepSyncSchema, type SleepSample, type SleepStage } from '../lib/schemas';
import {
  bedtimeKept, deepBaseline, deepBonus, lightsOutKept, minutesAfterEvening, nightOf, summarizeNights, targetAfterEvening,
} from './sleep';

/** Local-time sample on 2030-01-0d at hh:mm for `minutes`. */
const at = (day: number, hh: number, mm: number) => new Date(2030, 0, day, hh, mm);
const sample = (stage: SleepStage, start: Date, minutes: number): SleepSample => ({ stage, start, end: new Date(start.getTime() + minutes * 60_000) });

const night: SleepSample[] = [
  sample('InBed', at(1, 23, 20), 470),
  sample('Core', at(1, 23, 40), 60),
  sample('Deep', at(2, 0, 40), 50),
  sample('Awake', at(2, 1, 30), 5),
  sample('REM', at(2, 1, 35), 40),
  sample('Asleep', at(2, 1, 35), 40), // iPhone duplicate overlapping the Watch's REM
  sample('Core', at(2, 2, 15), 300),
];

describe('sleep math', () => {
  it('assigns samples starting 18:00–06:00 to the evening; daytime naps are ignored', () => {
    expect(nightOf(at(1, 23, 0))).toBe('2030-01-01');
    expect(nightOf(at(2, 3, 0))).toBe('2030-01-01');
    expect(nightOf(at(2, 14, 0))).toBeNull();
  });

  it('summarizes a night without double counting overlaps', () => {
    const [n] = summarizeNights(night);
    expect(n.night).toBe('2030-01-01');
    expect(new Date(n.bedtime)).toEqual(at(1, 23, 40));
    expect(new Date(n.wake)).toEqual(at(2, 7, 15));
    expect(n.asleepMinutes).toBe(60 + 50 + 40 + 300); // the 5-min awake gap is not sleep
    expect(n.deepMinutes).toBe(50);
    expect(n.remMinutes).toBe(40);
    expect(n.awakenings).toBe(1);
    expect(n.inBedMinutes).toBe(470);
  });

  it('stages after 06:00 still belong to the night that started before it; a separate nap does not', () => {
    const late = [sample('Core', at(1, 23, 50), 380), sample('REM', at(2, 6, 10), 40), sample('Core', at(2, 14, 0), 30)];
    const [n] = summarizeNights(late);
    expect(n.asleepMinutes).toBe(420);
    expect(new Date(n.wake)).toEqual(at(2, 6, 50));
    expect(summarizeNights(late)).toHaveLength(1);
  });

  it('times after midnight count as later than evening targets', () => {
    expect(minutesAfterEvening(at(2, 0, 30))).toBeGreaterThan(targetAfterEvening('23:00'));
    expect(targetAfterEvening('01:00')).toBeGreaterThan(targetAfterEvening('23:00'));
  });

  it('lights-out and bedtime vows', () => {
    const [n] = summarizeNights(night); // asleep 23:40
    expect(lightsOutKept(n, '23:45')).toBe(true);
    expect(lightsOutKept(n, '23:30')).toBe(false);
    expect(lightsOutKept(n, '00:15')).toBe(true);
    expect(bedtimeKept(n, '23:15')).toBe(true); // 25 min late, inside ±30
    expect(bedtimeKept(n, '23:00')).toBe(false); // 40 min late
  });

  it('deep-sleep bonus needs a baseline of 3 nights and is capped', () => {
    const nights = (deep: number[]) => deep.map((d) => ({ ...summarizeNights(night)[0], deepMinutes: d }));
    expect(deepBaseline(nights([40, 50]))).toBeNull();
    expect(deepBaseline(nights([40, 50, 60]))).toBe(50);
    const tonight = { ...summarizeNights(night)[0], deepMinutes: 75 };
    expect(deepBonus(tonight, 50)).toBe(10); // 25 min above → 2 steps × 5
    expect(deepBonus({ ...tonight, deepMinutes: 200 }, 50)).toBe(25); // cap
    expect(deepBonus(tonight, null)).toBe(0);
  });
});

describe('Shortcut sleep payload', () => {
  it('accepts Shortcut stage strings in any case', () => {
    expect(normalizeSleepStage('In Bed')).toBe('InBed');
    expect(normalizeSleepStage('Asleep Core')).toBe('Core');
    expect(normalizeSleepStage('rem')).toBe('REM');
    expect(normalizeSleepStage('AWAKE')).toBe('Awake');
    expect(normalizeSleepStage('Asleep (Unspecified)')).toBe('Asleep');
    expect(normalizeSleepStage('napping')).toBeUndefined();
  });

  it('parses ISO and Shortcut default dates', () => {
    expect(parseShortcutDate('2030-01-01T23:40:00Z')?.toISOString()).toBe('2030-01-01T23:40:00.000Z');
    expect(parseShortcutDate('Jan 1, 2030 at 11:40 PM')).toEqual(at(1, 23, 40));
    expect(parseShortcutDate('garbage')).toBeUndefined();
  });

  it('validates the body: type sleep (any case), end after start', () => {
    const ok = SleepSyncSchema.safeParse({ type: 'SLEEP', samples: [{ start: '2030-01-01T23:00:00Z', end: '2030-01-02T00:00:00Z', stage: 'asleep deep' }] });
    expect(ok.success && ok.data.samples[0].stage).toBe('Deep');
    expect(SleepSyncSchema.safeParse({ type: 'sleep', samples: [{ start: '2030-01-02T00:00:00Z', end: '2030-01-01T23:00:00Z', stage: 'Core' }] }).success).toBe(false);
    expect(SleepSyncSchema.safeParse({ type: 'sleep', samples: [{ start: 'x', end: 'y', stage: 'Core' }] }).success).toBe(false);
  });
});
