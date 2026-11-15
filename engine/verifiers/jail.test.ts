import { describe, expect, it } from 'vitest';
import type { Reading } from '../../lib/schemas';
import { JailVerifier, REASON_REMOVED } from './jail';
import { feed } from './testing';

/** Home Base readings every 100 ms from `fromMs` to `toMs` with the given jail bit. */
const jail = (bit: 0 | 1, fromMs: number, toMs: number): Reading[] =>
  Array.from({ length: (toMs - fromMs) / 100 }, (_, i) => ({ t: fromMs + i * 100, source: 'homebase', jail: bit }));

const types = (events: ReturnType<typeof feed>) => events.map((e) => (e.type === 'device' ? e.cmd : e.type));

describe('JailVerifier', () => {
  it('waits for the phone, locks, counts down, then unlocks and finishes', () => {
    const v = new JailVerifier({ target: 3, progress: 0 });

    const events = feed(v, [...jail(0, 0, 500), ...jail(1, 500, 4_000)]);

    expect(types(events)).toEqual([
      'LOCK', 'SEG:   3',
      'progress', 'SEG:   2',
      'progress', 'SEG:   1',
      'progress', 'UNLOCK', 'done',
    ]);
    expect(feed(v, jail(0, 4_000, 6_000))).toEqual([]); // finished: removal no longer matters
  });

  it('ignores IR flicker shorter than 1 s', () => {
    const v = new JailVerifier({ target: 3, progress: 0 });

    const events = feed(v, [...jail(1, 0, 1_000), ...jail(0, 1_000, 1_800), ...jail(1, 1_800, 3_500)]);

    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(events.some((e) => e.type === 'fail')).toBe(false);
  });

  it('removing the phone early unlocks and fails', () => {
    const v = new JailVerifier({ target: 20, progress: 0 });

    const events = feed(v, [...jail(1, 0, 5_000), ...jail(0, 5_000, 7_000)]);

    expect(events.slice(-2)).toEqual([{ type: 'device', cmd: 'UNLOCK' }, { type: 'fail', reason: REASON_REMOVED }]);
  });

  it('a resumed quest continues from the seconds already held', () => {
    const v = new JailVerifier({ target: 20, progress: 18 });

    const events = feed(v, jail(1, 0, 2_500));

    expect(types(events)).toEqual(['LOCK', 'SEG:   2', 'progress', 'SEG:   1', 'progress', 'UNLOCK', 'done']);
  });

  it('ignores readings without a jail bit', () => {
    expect(new JailVerifier({ target: 3, progress: 0 }).push({ t: 0, source: 'phone', ax: 1 })).toEqual([]);
  });

  describe('without IR: light sensor covered by the phone', () => {
    const light = (value: number, fromMs: number, toMs: number): Reading[] =>
      Array.from({ length: (toMs - fromMs) / 100 }, (_, i) => ({ t: fromMs + i * 100, source: 'homebase', light: value }));

    it('a lit room then a covered sensor locks; holding it covered finishes the vow', () => {
      const v = new JailVerifier({ target: 2, progress: 0 });

      const events = feed(v, [...light(750, 0, 1_000), ...light(40, 1_000, 3_500)]);

      expect(types(events)[0]).toBe('LOCK');
      expect(events.at(-1)).toEqual({ type: 'done' });
    });

    it('lifting the phone (sensor bright again) for over 1 s fails', () => {
      const v = new JailVerifier({ target: 20, progress: 0 });

      const events = feed(v, [...light(750, 0, 500), ...light(40, 500, 3_000), ...light(720, 3_000, 5_000)]);

      expect(events.at(-1)).toEqual({ type: 'fail', reason: REASON_REMOVED });
    });

    it('a dark room (never calibrated) or phone/Watch readings never lock', () => {
      const v = new JailVerifier({ target: 2, progress: 0 });

      const events = feed(v, [
        ...light(60, 0, 2_000), // below MIN_AMBIENT_LIGHT: can't tell covered from dark
        { t: 2_000, source: 'phone', ax: 0, ay: 0, az: 1 },
      ]);

      expect(events).toEqual([]);
    });

    it('once IR reports, light is ignored', () => {
      const v = new JailVerifier({ target: 5, progress: 0 });

      const events = feed(v, [...jail(0, 0, 500), ...light(750, 500, 800), ...light(10, 800, 2_000)]);

      expect(events).toEqual([]); // IR says no phone; a dark light sensor doesn't override it
    });
  });
});
