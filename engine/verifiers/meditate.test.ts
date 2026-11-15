import { describe, expect, it } from 'vitest';
import type { Reading } from '../../lib/schemas';
import { BASELINE_SAMPLES, MeditateVerifier, REASON_LOUD, REASON_RELEASED } from './meditate';
import { waveform } from '../../bridge/simulator';
import { feed } from './testing';

let clock = 0;
/** `ms` of Home Base readings at 100 ms with the given button and sound. */
const samples = (ms: number, btn: 0 | 1, snd: number): Reading[] =>
  Array.from({ length: ms / 100 }, () => ({ t: (clock += 100), source: 'homebase', btn, snd }));

const calibrated = (target: number, progress = 0): MeditateVerifier => {
  clock = 0;
  const v = new MeditateVerifier({ target, progress });
  feed(v, samples(BASELINE_SAMPLES * 100, 0, 100)); // quiet room ≈ 100
  return v;
};

describe('MeditateVerifier', () => {
  it('counts held, quiet seconds and finishes at the target', () => {
    const v = calibrated(3);

    const events = feed(v, samples(3_200, 1, 120));

    expect(events.filter((e) => e.type === 'progress').map((e) => (e as { value: number }).value)).toEqual([1, 2, 3]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('forgives breaks up to 2 s', () => {
    const v = calibrated(4);

    const events = feed(v, [...samples(1_000, 1, 100), ...samples(1_500, 0, 100), ...samples(2_000, 1, 100)]);

    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(events.some((e) => e.type === 'rep.rejected')).toBe(false);
  });

  it('a longer release pauses the timer and warns once', () => {
    const v = calibrated(10);

    const events = feed(v, [...samples(2_000, 1, 100), ...samples(5_000, 0, 100)]);

    expect(events.filter((e) => e.type === 'rep.rejected')).toEqual([{ type: 'rep.rejected', reason: REASON_RELEASED }]);
    const lastProgress = events.filter((e) => e.type === 'progress').at(-1);
    expect(lastProgress).toEqual({ type: 'progress', value: 3 }); // ~1.9 s held + 2 s grace, then paused
  });

  it('noise above baseline + margin counts as a break ("too loud")', () => {
    const v = calibrated(10);

    const events = feed(v, [...samples(1_000, 1, 100), ...samples(3_000, 1, 400)]);

    expect(events).toContainEqual({ type: 'rep.rejected', reason: REASON_LOUD });
  });

  it('nothing counts until calibrated and the button is first pressed', () => {
    clock = 0;
    const v = new MeditateVerifier({ target: 2, progress: 0 });

    expect(feed(v, samples(BASELINE_SAMPLES * 100 - 100, 1, 100))).toEqual([]);
    expect(feed(v, samples(3_000, 0, 100)).some((e) => e.type === 'progress' || e.type === 'rep.rejected')).toBe(false);
  });

  it('the simulator meditate waveform: one "too loud" warning, still completes', () => {
    const events = feed(new MeditateVerifier({ target: 30, progress: 0 }), waveform('meditate', 40_000));

    expect(events.filter((e) => e.type === 'rep.rejected')).toEqual([{ type: 'rep.rejected', reason: REASON_LOUD }]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
