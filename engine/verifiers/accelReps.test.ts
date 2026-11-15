import { describe, expect, it } from 'vitest';
import { SQUAT_REP_MS, waveform } from '../../bridge/simulator';
import type { Reading } from '../../lib/schemas';
import {
  AccelRepCounter,
  REASON_NOT_DEEP_ENOUGH,
  REASON_SHAKING,
  REASON_TOO_FAST,
  REASON_TOO_SLOW,
  REASON_TUMBLING,
} from './accelReps';
import { rest, shake, squat, squatHalf, times, trace, wave, type Segment } from './motionTraces';
import { feed, withRest } from './testing';
import type { VerifierEvent } from './types';

const types = (events: VerifierEvent[]): string[] => events.map((e) => e.type);
const reasons = (events: VerifierEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'rep.rejected' ? [e.reason] : []));

/** Standing still, the given motion, standing still again. */
const session = (segments: Segment[], options?: Parameters<typeof trace>[1]): Reading[] =>
  trace([rest(800), ...segments, rest(800)], options);

const simulatorSquats = (n: number): Reading[] => withRest(waveform('squat', n * SQUAT_REP_MS), 'squat');

describe('AccelRepCounter — real squats pass', () => {
  it('calibrates on 2 squats, then counts every full squat', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session(times(6, squat())));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep', 'rep', 'rep']);
    expect(counter.count).toBe(6);
    expect(counter.isCalibrated).toBe(true);
  });

  // ±0.02 g uniform per axis is several times a phone accelerometer's noise floor.
  it.each([1, 2, 3, 4, 5])('is stable under sensor noise (seed %i, ±0.02 g, ±15 deg/s)', (seed) => {
    const events = feed(new AccelRepCounter('squat'), session(times(6, squat()), { seed, noiseG: 0.02, noiseDps: 15 }));

    expect(types(events)).toEqual(Array(6).fill('rep'));
  });

  it('counts slow (3.5 s) and brisk (1.2 s) squats', () => {
    const events = feed(new AccelRepCounter('squat'), session([squat(), squat(), squat(0.4, 3_500), squat(0.4, 1_200)]));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep']);
  });

  it('counts squats with pauses between them', () => {
    const events = feed(new AccelRepCounter('squat'), session([squat(), rest(1_000), squat(), rest(700), squat()]));

    expect(types(events)).toEqual(['rep', 'rep', 'rep']);
  });

  it('works without gyro data (a Watch that streams accel only)', () => {
    const events = feed(new AccelRepCounter('squat'), session(times(4, squat()), { withRotation: false }));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep']);
  });

  it('counts the simulator: 2 calibration squats, then every 4th (half depth) is rejected', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, simulatorSquats(8));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep.rejected', 'rep', 'rep', 'rep', 'rep.rejected']);
    expect(reasons(events)).toEqual([REASON_NOT_DEEP_ENOUGH, REASON_NOT_DEEP_ENOUGH]);
    expect(counter.count).toBe(6);
  });
});

describe('AccelRepCounter — half squats are rejected', () => {
  it('rejects squats under 70 % of the calibrated depth as not deep enough', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), squat(0.2), squat(), squat(0.22), squat()]));

    expect(types(events)).toEqual(['rep', 'rep', 'rep.rejected', 'rep', 'rep.rejected', 'rep']);
    expect(reasons(events)).toEqual([REASON_NOT_DEEP_ENOUGH, REASON_NOT_DEEP_ENOUGH]);
    expect(counter.count).toBe(4);
  });

  it('never counts tiny bobs (below the calibration minimum)', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session(times(4, squat(0.05))));

    expect(types(events)).not.toContain('rep');
    expect(counter.isCalibrated).toBe(false);
  });

  it('counts nothing until 2 calibration squats are done', () => {
    const counter = new AccelRepCounter('squat');

    expect(feed(counter, session([squat()]))).toEqual([]);
    expect(counter.isCalibrated).toBe(false);
  });
});

describe('AccelRepCounter — hand waving is rejected', () => {
  it('never counts a phone waved in the hand, and says why', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([wave(10_000)]));

    expect(counter.count).toBe(0);
    expect(types(events)).not.toContain('rep');
    expect(reasons(events).length).toBeGreaterThan(0);
    expect(new Set(reasons(events))).toEqual(new Set([REASON_TUMBLING]));
  });

  it('rejects waving after calibration without adding reps', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), rest(500), wave(8_000, { hz: 0.8, tiltDeg: 60 }), rest(800), squat()]));

    expect(counter.count).toBe(3); // 2 calibration + the real squat after
    expect(reasons(events)).toContain(REASON_TUMBLING);
    expect(types(events).at(-1)).toBe('rep');
  });

  it('cannot be calibrated by waving: real squats afterwards still calibrate cleanly', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([wave(6_000), rest(1_000), squat(), squat(), squat()]));

    expect(types(events).filter((t) => t === 'rep')).toHaveLength(3);
  });
});

describe('AccelRepCounter — shaking is rejected', () => {
  it('never counts a shaken phone, and says why', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([shake(8_000)]));

    expect(counter.count).toBe(0);
    expect(reasons(events)).toContain(REASON_SHAKING);
  });

  it('rejects shaking after calibration (even with no gyro data)', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), rest(500), shake(6_000), rest(800)], { withRotation: false }));

    expect(counter.count).toBe(2);
    expect(reasons(events)).toContain(REASON_SHAKING);
  });

  it('does not count fast vibration without vertical travel at all', () => {
    const counter = new AccelRepCounter('squat');

    expect(feed(counter, session([shake(4_000, { hz: 8, g: 0.8, driftM: 0 })]))).toEqual([]);
  });
});

describe('AccelRepCounter — timing', () => {
  it('rejects a full-depth squat faster than 0.8 s as too fast', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), rest(400), squat(0.4, 650), rest(400), squat()]));

    expect(reasons(events)).toEqual([REASON_TOO_FAST]);
    expect(counter.count).toBe(3);
  });

  it('counts a squat with a 1.5 s pause at the bottom (3.5 s in all)', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), rest(400), squatHalf(0), rest(1_500), squatHalf(1), rest(600), squat()]));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep']);
  });

  it('rejects a squat held at the bottom past 4 s as too slow', () => {
    const counter = new AccelRepCounter('squat');

    const events = feed(counter, session([squat(), squat(), rest(400), squatHalf(0), rest(3_000), squatHalf(1), rest(600), squat()]));

    expect(reasons(events)).toEqual([REASON_TOO_SLOW]);
    expect(counter.count).toBe(3);
  });
});

describe('AccelRepCounter — inputs', () => {
  it('counts exercises that start upward (sit-up with an armband)', () => {
    const situp = (): Segment => {
      const s = squat(0.35, 1_800);
      return { ms: s.ms, at: (t) => ({ ...s.at(t), aVert: -s.at(t).aVert }) };
    };

    const events = feed(new AccelRepCounter('situp'), session(times(4, situp())));

    expect(types(events)).toEqual(['rep', 'rep', 'rep', 'rep']);
  });

  it('ignores readings without accelerometer data (e.g. the Home Base pad)', () => {
    expect(feed(new AccelRepCounter('squat'), [{ t: 0, source: 'homebase', pad: 1 }])).toEqual([]);
  });

  it('keeps its calibration when the source restarts (t goes backwards)', () => {
    const counter = new AccelRepCounter('squat');
    feed(counter, session([squat(), squat()]));

    const events = feed(counter, session([squat()]));

    expect(types(events)).toEqual(['rep']);
    expect(counter.count).toBe(3);
  });
});
