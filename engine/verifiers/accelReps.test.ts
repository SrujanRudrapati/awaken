import { describe, expect, it } from 'vitest';
import { SAMPLE_MS, SQUAT_REP_MS, waveform } from '../../bridge/simulator';
import type { Reading } from '../../lib/schemas';
import { AccelRepCounter } from './accelReps';
import { feed, seededRandom, withRest } from './testing';

const squats = (n: number): Reading[] => withRest(waveform('squat', n * SQUAT_REP_MS), 'squat');

const types = (events: { type: string }[]): string[] => events.map((e) => e.type);

/**
 * Phone readings where one axis follows `swing` (g offsets from rest, one per rep) as a
 * cosine of `repMs`; the other axes sit still. Starts and ends at rest.
 */
function reps(
  swings: readonly number[],
  { axis = 'ax', rest = 0, repMs = 1_500 }: { axis?: 'ax' | 'ay' | 'az'; rest?: number; repMs?: number } = {},
): Reading[] {
  const perRep = repMs / SAMPLE_MS;
  const samples = swings.flatMap((swing) =>
    Array.from({ length: perRep }, (_, i) => rest + (swing * (1 - Math.cos((2 * Math.PI * i) / perRep))) / 2),
  );
  const restTail = Array.from({ length: 5 }, () => rest);
  return [rest, rest, rest, ...samples, ...restTail].map((v, i) => ({
    t: i * SAMPLE_MS,
    source: 'phone',
    ax: 0,
    ay: 0,
    az: 0,
    [axis]: v,
  }));
}

describe('AccelRepCounter', () => {
  it('calibrates on 2 simulator squats, then counts full reps and rejects shallow ones', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, squats(8)); // squats 4 and 8 are half depth

    expect(types(events)).toEqual([
      'rep', 'rep', // calibration reps
      'rep', 'rep.rejected',
      'rep', 'rep', 'rep', 'rep.rejected',
    ]);
    expect(events.find((e) => e.type === 'rep.rejected')).toEqual({
      type: 'rep.rejected',
      reason: 'not deep enough',
    });
    expect(counter.count).toBe(6);
    expect(counter.isCalibrated).toBe(true);
  });

  it.each([1, 2, 3, 4, 5])('gives the same result with ±0.05 g noise (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const jitter = (v: number | undefined): number => (v ?? 0) + (random() * 0.1 - 0.05);
    const noisy = squats(8).map((r) => ({ ...r, ax: jitter(r.ax), ay: jitter(r.ay), az: jitter(r.az) }));

    expect(types(feed(new AccelRepCounter('squat'), noisy))).toEqual([
      'rep', 'rep', 'rep', 'rep.rejected', 'rep', 'rep', 'rep', 'rep.rejected',
    ]);
  });

  it('counts nothing until 2 calibration reps are done', () => {
    const counter = new AccelRepCounter('situp');

    expect(feed(counter, reps([0.9]))).toEqual([]);
    expect(counter.isCalibrated).toBe(false);
  });

  it('ignores motion below the calibration minimum', () => {
    const counter = new AccelRepCounter('situp');

    expect(feed(counter, reps([0.2, 0.2, 0.2, 0.2]))).toEqual([]);
    expect(counter.isCalibrated).toBe(false);
  });

  it.each(['ax', 'ay', 'az'] as const)('finds the dominant axis (%s) and handles negative swings', (axis) => {
    const counter = new AccelRepCounter('jumpingjack');

    const events = feed(counter, reps([-1.2, -1.2, -1.2, -0.5, -1.1], { axis, rest: 0.4 }));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep.rejected', 'rep']);
  });

  it('rejects reps faster than 0.7 s as too fast', () => {
    const counter = new AccelRepCounter('armPushup');
    const calibration = reps([1, 1]);
    const startT = calibration.at(-1)!.t + SAMPLE_MS;
    // Two full-depth excursions 0.5 s apart, each held 300 ms.
    const fast = [1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0].map(
      (ax, i): Reading => ({ t: startT + i * SAMPLE_MS, source: 'phone', ax, ay: 0, az: 0 }),
    );

    const events = feed(counter, [...calibration, ...fast]);

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep.rejected']);
    expect(events.at(-1)).toEqual({ type: 'rep.rejected', reason: 'too fast' });
  });

  it('ignores readings without accelerometer data (e.g. the Home Base pad)', () => {
    const counter = new AccelRepCounter('squat');

    expect(feed(counter, [{ t: 0, source: 'homebase', pad: 1 }])).toEqual([]);
  });

  it('keeps its calibration when the source restarts (t goes backwards)', () => {
    const counter = new AccelRepCounter('squat');
    feed(counter, reps([1, 1]));

    const events = feed(counter, reps([1]));

    expect(types(events)).toEqual(['rep']);
    expect(counter.count).toBe(3);
  });
});
