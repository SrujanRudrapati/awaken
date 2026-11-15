import { describe, expect, it } from 'vitest';
import { PUSHUP_REP_MS, SAMPLE_MS, readingAt, waveform } from '../../bridge/simulator';
import type { Reading } from '../../lib/schemas';
import { PushupCounter } from './pushup';
import { feed, seededRandom, withRest } from './testing';

/** Simulator push-ups: every 4th rep is shallow (22 cm). */
const reps = (n: number): Reading[] => withRest(waveform('pushup', n * PUSHUP_REP_MS));

const types = (events: { type: string }[]): string[] => events.map((e) => e.type);

const EIGHT_FULL_TWO_SHALLOW = [
  'rep', 'rep', 'rep', 'rep.rejected',
  'rep', 'rep', 'rep', 'rep.rejected',
  'rep', 'rep',
];

describe('PushupCounter', () => {
  it('counts 8 reps and rejects 2 shallow ones from the simulator waveform', () => {
    const counter = new PushupCounter();

    const events = feed(counter, reps(10));

    expect(types(events)).toEqual(EIGHT_FULL_TWO_SHALLOW);
    expect(events.filter((e) => e.type === 'rep').map((e) => e.type === 'rep' && e.count)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(events.find((e) => e.type === 'rep.rejected')).toEqual({
      type: 'rep.rejected',
      reason: 'not deep enough',
    });
    expect(counter.count).toBe(8);
  });

  it.each([1, 2, 3, 4, 5])('gives the same result with ±1.5 cm sensor noise (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const noisy = reps(10).map((r) => ({ ...r, dist: r.dist + (random() * 3 - 1.5) }));

    expect(types(feed(new PushupCounter(), noisy))).toEqual(EIGHT_FULL_TWO_SHALLOW);
  });

  it('ignores out-of-range glitches (missed echo: 0 cm / 500 cm)', () => {
    const glitchy = reps(10).map((r, i) => (i % 7 === 3 ? { ...r, dist: i % 2 ? 0 : 500 } : r));

    expect(types(feed(new PushupCounter(), glitchy))).toEqual(EIGHT_FULL_TWO_SHALLOW);
  });

  it('ignores in-range single-sample spikes', () => {
    const spiky = reps(10).map((r, i) => (i % 7 === 3 ? { ...r, dist: i % 2 ? 5 : 150 } : r));

    expect(types(feed(new PushupCounter(), spiky))).toEqual(EIGHT_FULL_TWO_SHALLOW);
  });

  it('ignores a dip faster than 0.5 s', () => {
    const dists = [40, 40, 40, 10, 10, 40, 40, 40, 40];
    const readings = dists.map((dist, i) => ({ ...readingAt('idle', i * SAMPLE_MS), dist }));

    expect(feed(new PushupCounter(), readings)).toEqual([]);
  });

  it('does not count jitter around the top threshold', () => {
    const readings = Array.from({ length: 40 }, (_, i) => ({
      ...readingAt('idle', i * SAMPLE_MS),
      dist: i % 2 ? 34 : 36,
    }));

    expect(feed(new PushupCounter(), readings)).toEqual([]);
  });

  it('uses calibrated distances', () => {
    // Taller player: top 60 cm, chest at 20 cm. Simulator 40→10 mapped onto 60→20.
    const tall = reps(10).map((r) => ({ ...r, dist: 20 + ((r.dist - 10) * 40) / 30 }));
    const counter = new PushupCounter();
    counter.calibrate(60, 20);

    expect(types(feed(counter, tall))).toEqual(EIGHT_FULL_TWO_SHALLOW);
  });

  it('rejects a calibration whose range is too small or not finite', () => {
    const counter = new PushupCounter();

    expect(() => counter.calibrate(20, 15)).toThrow(RangeError);
    expect(() => counter.calibrate(10, 40)).toThrow(RangeError);
    expect(() => counter.calibrate(Number.NaN, 10)).toThrow(RangeError);
  });

  it('drops a half-finished rep when the device clock restarts, keeping the count', () => {
    const counter = new PushupCounter();
    feed(counter, reps(1));
    const halfRep = waveform('pushup', 700).map((r) => ({ ...r, t: r.t + 10_000 }));
    feed(counter, halfRep); // now at the bottom

    const events = feed(counter, reps(2)); // t restarts at 0

    expect(types(events)).toEqual(['rep', 'rep']);
    expect(counter.count).toBe(3);
  });
});
