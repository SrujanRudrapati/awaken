import { describe, expect, it } from 'vitest';
import { SAMPLE_MS, SQUAT_REP_MS, readingAt, waveform } from '../../bridge/simulator';
import type { Reading } from '../../lib/schemas';
import { SquatCounter } from './squat';
import { feed, seededRandom, withRest } from './testing';

const squats = (n: number): Reading[] => withRest(waveform('squat', n * SQUAT_REP_MS));

const fromAz = (values: number[]): Reading[] =>
  values.map((az, i) => ({ ...readingAt('idle', i * SAMPLE_MS), az }));

describe('SquatCounter', () => {
  it('counts 5 reps from the simulator waveform', () => {
    const counter = new SquatCounter();

    const events = feed(counter, squats(5));

    expect(events).toEqual([1, 2, 3, 4, 5].map((count) => ({ type: 'rep', count })));
    expect(counter.count).toBe(5);
  });

  it.each([1, 2, 3, 4, 5])('gives the same result with ±0.05 g noise (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const noisy = squats(5).map((r) => ({ ...r, az: r.az + (random() * 0.1 - 0.05) }));

    expect(feed(new SquatCounter(), noisy)).toHaveLength(5);
  });

  it('counts the same whichever axis gravity is on', () => {
    const sideways = squats(5).map((r) => ({ ...r, ax: r.az, az: 0 }));

    expect(feed(new SquatCounter(), sideways)).toHaveLength(5);
  });

  it('ignores a single-sample bump', () => {
    const bumped = fromAz([1, 1, 1, 2.5, 1, 1, 1, 1, 2.5, 1, 1, 1]);

    expect(feed(new SquatCounter(), bumped)).toEqual([]);
  });

  it('ignores peaks less than 0.8 s after the previous rep', () => {
    const peak = [1.7, 1.7, 1.7, 1, 1]; // one peak every 0.5 s
    const fast = fromAz([1, 1, ...peak, ...peak, ...peak, ...peak]);

    expect(feed(new SquatCounter(), fast)).toHaveLength(2); // every other peak
  });

  it('does not count a rise that never comes back down', () => {
    expect(feed(new SquatCounter(), fromAz([1, 1, 1.6, 1.6, 1.6, 1.6, 1.3, 1.3, 1.3]))).toEqual([]);
  });

  it('keeps counting after the device clock restarts', () => {
    const counter = new SquatCounter();
    feed(counter, squats(2).map((r) => ({ ...r, t: r.t + 60_000 })));

    feed(counter, squats(2));

    expect(counter.count).toBe(4);
  });
});
