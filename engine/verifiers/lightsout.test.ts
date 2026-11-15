import { describe, expect, it } from 'vitest';
import type { Reading } from '../../lib/schemas';
import { BASELINE_SAMPLES, LightsOutVerifier } from './lightsout';
import { waveform } from '../../bridge/simulator';
import { feed } from './testing';

let clock = 0;
const light = (ms: number, value: number): Reading[] =>
  Array.from({ length: ms / 100 }, () => ({ t: (clock += 100), source: 'homebase', light: value }));

const calibrated = (lit = 600): LightsOutVerifier => {
  clock = 0;
  const v = new LightsOutVerifier();
  feed(v, light(BASELINE_SAMPLES * 100, lit));
  return v;
};

describe('LightsOutVerifier', () => {
  it('calibrates the threshold from the lit room', () => {
    expect(calibrated(600).darkThreshold).toBe(150);
    expect(calibrated(40).darkThreshold).toBe(30); // already dim: floor
  });

  it('finishes once the room stays dark for 2 s', () => {
    const v = calibrated();

    const events = feed(v, light(2_500, 20));

    expect(events).toEqual([{ type: 'progress', value: 1 }, { type: 'device', cmd: 'SEG:DARK' }, { type: 'done' }]);
  });

  it('a brief shadow does not count', () => {
    const v = calibrated();

    const events = feed(v, [...light(1_000, 20), ...light(500, 600), ...light(1_500, 20)]);

    expect(events).toEqual([]);
  });

  it('ignores readings without a light value', () => {
    expect(calibrated().push({ t: 99_999, source: 'homebase', pad: 1 })).toEqual([]);
  });

  it('the simulator lightsout waveform completes ~2 s after the lights go off', () => {
    const events = feed(new LightsOutVerifier(), waveform('lightsout', 8_000));

    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
