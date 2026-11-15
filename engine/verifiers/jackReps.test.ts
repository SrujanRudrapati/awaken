import { describe, expect, it } from 'vitest';
import type { Reading } from '../../lib/schemas';
import { ROTATION_LIMITS_DPS, ROTATION_MAX_DPS } from './accelReps';
import { JackRepCounter, REASON_WAVING } from './jackReps';
import { jack, rest, squat, times, trace, wave, type Segment } from './motionTraces';
import { createRepCounter } from './repCounter';
import { feed } from './testing';
import type { VerifierEvent } from './types';

const reasons = (events: VerifierEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'rep.rejected' ? [e.reason] : []));

const session = (segments: Segment[], options?: Parameters<typeof trace>[1]): Reading[] =>
  trace([rest(800), ...segments, rest(800)], options);

const maxRotation = (readings: Reading[]): number =>
  Math.max(...readings.map((r) => Math.hypot(r.rx ?? 0, r.ry ?? 0, r.rz ?? 0)));

describe('JackRepCounter — armband jumping jacks pass', () => {
  it.each([1_000, 1_200, 1_500])('counts every %i ms armband jack, though the arm spins far past 240 °/s', (repMs) => {
    const readings = session(times(8, jack(repMs)));
    const counter = new JackRepCounter();

    const events = feed(counter, readings);

    expect(maxRotation(readings)).toBeGreaterThan(ROTATION_MAX_DPS);
    expect(counter.count).toBe(8);
    expect(reasons(events)).not.toContain(REASON_WAVING);
  });

  it.each([1, 2, 3])('is stable under sensor noise (seed %i, ±0.02 g, ±15 °/s)', (seed) => {
    const counter = new JackRepCounter();

    feed(counter, session(times(8, jack()), { seed, noiseG: 0.02, noiseDps: 15 }));

    expect(counter.count).toBe(8);
  });

  it('tolerates a gyro bias of 2 °/s', () => {
    const counter = new JackRepCounter();

    feed(counter, session(times(8, jack()), { gyroBiasDps: 2 }));

    expect(counter.count).toBe(8);
  });

  it('works without gyro data', () => {
    const counter = new JackRepCounter();

    feed(counter, session(times(8, jack()), { withRotation: false }));

    expect(counter.count).toBe(8);
  });

  it('counts pocket jacks (the thigh swings ~30°)', () => {
    const counter = new JackRepCounter();

    feed(counter, session(times(8, jack(1_200, { armDeg: 30, armM: 0.4, hopM: 0.06 }))));

    expect(counter.count).toBe(8);
  });
});

describe('JackRepCounter — hand waving is rejected', () => {
  it.each([
    ['1.2 Hz ±50° with a big bob', { hz: 1.2, tiltDeg: 50 }],
    ['0.8 Hz ±60°', { hz: 0.8, tiltDeg: 60 }],
    ['2 Hz ±60°', { hz: 2, tiltDeg: 60 }],
  ] as const)('never counts waving (%s) and says why', (_label, options) => {
    const counter = new JackRepCounter();

    const events = feed(counter, session([wave(10_000, options)]));

    expect(counter.count).toBe(0);
    expect(reasons(events).length).toBeGreaterThan(0);
  });

  it('calls it phone waving', () => {
    const events = feed(new JackRepCounter(), session([wave(6_000)]));

    expect(reasons(events)).toContain(REASON_WAVING);
  });

  it('rejects waving after calibration without adding reps', () => {
    const counter = new JackRepCounter();

    feed(counter, session([jack(), jack(), rest(600), wave(6_000), rest(800), jack()]));

    expect(counter.count).toBe(3);
  });

  it('rejects waving even with a gyro bias of 2 °/s', () => {
    const counter = new JackRepCounter();

    feed(counter, session([wave(10_000)], { gyroBiasDps: 2 }));

    expect(counter.count).toBe(0);
  });
});

describe('JackRepCounter — partial jacks', () => {
  it('rejects a half jack (arm to 70° of 160°) as not deep enough', () => {
    const counter = new JackRepCounter();

    const events = feed(counter, session([jack(), jack(), jack(1_200, { armDeg: 70 }), jack()]));

    expect(counter.count).toBe(3);
    expect(reasons(events)).toEqual(['not deep enough']);
  });

  it('ignores readings without accelerometer data', () => {
    expect(feed(new JackRepCounter(), [{ t: 0, source: 'homebase', pad: 1 }])).toEqual([]);
  });

  it('keeps its calibration when the source restarts (t goes backwards)', () => {
    const counter = new JackRepCounter();
    feed(counter, session([jack(), jack()]));

    feed(counter, session([jack()]));

    expect(counter.count).toBe(3);
  });

  it('exposes a debug snapshot (calibration, progress, last reason)', () => {
    const counter = new JackRepCounter();
    feed(counter, session([jack(), jack(), jack(1_200, { armDeg: 70 })]));

    expect(counter.debugState).toMatchObject({ calibrated: true, lastReason: 'not deep enough' });
    expect(counter.debugState.depth).toBeGreaterThan(0);
  });
});

describe('per-exercise rotation limits', () => {
  it('keeps 240 °/s for squats, sit-ups and arm push-ups; jacks use the swing counter', () => {
    expect(ROTATION_LIMITS_DPS.squat).toBe(240);
    expect(ROTATION_LIMITS_DPS.situp).toBe(240);
    expect(ROTATION_LIMITS_DPS.armPushup).toBe(240);
    expect(createRepCounter('jumpingjack')).toBeInstanceOf(JackRepCounter);
  });

  it('a squat counter still rejects armband jacks as tumbling (they are not squats)', () => {
    const counter = createRepCounter('squat');

    const events = feed(counter, session(times(6, jack())));

    expect(counter.count).toBe(0);
    expect(reasons(events)).toContain('phone tumbling');
  });

  it('a jack counter does not count squats', () => {
    const counter = createRepCounter('jumpingjack');

    feed(counter, session(times(6, squat())));

    expect(counter.count).toBe(0);
  });
});
