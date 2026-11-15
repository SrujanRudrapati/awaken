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
});
