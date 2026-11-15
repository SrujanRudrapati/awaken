import { describe, expect, it } from 'vitest';
import { PUSHUP_REP_MS, waveform } from '../../bridge/simulator';
import type { Bit, Reading } from '../../lib/schemas';
import { MAX_HOLD_MS, PadPushupCounter } from './padPushup';
import { feed, withRest } from './testing';

const SAMPLE = 20; // ms — faster than the simulator so debounce timing can be exercised

/** Builds homebase readings from [padState, durationMs] segments sampled every 20 ms. */
function pad(segments: readonly [Bit, number][], startT = 0): Reading[] {
  let t = startT;
  return segments.flatMap(([state, ms]) =>
    Array.from({ length: ms / SAMPLE }, () => {
      const reading: Reading = { t, source: 'homebase', pad: state };
      t += SAMPLE;
      return reading;
    }),
  );
}

const types = (events: { type: string }[]): string[] => events.map((e) => e.type);

describe('PadPushupCounter', () => {
  it('counts every simulator rep despite contact bounce on each edge', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, withRest(waveform('pushup', 10 * PUSHUP_REP_MS), 'pushup'));

    expect(events).toHaveLength(10);
    expect(events.map((e) => e.type === 'rep' && e.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(counter.count).toBe(10);
  });

  it('counts on release, not on press', () => {
    const counter = new PadPushupCounter();

    expect(feed(counter, pad([[0, 200], [1, 400]]))).toEqual([]);
    expect(feed(counter, pad([[0, 200]], 600))).toEqual([{ type: 'rep', count: 1 }]);
  });

  it('ignores presses shorter than the 80 ms debounce', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, pad([[0, 200], [1, 60], [0, 400], [1, 40], [0, 400]]));

    expect(events).toEqual([]);
  });

  it('ignores a release bounce that lasts under 80 ms', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, pad([[0, 200], [1, 300], [0, 40], [1, 300], [0, 300]]));

    expect(events).toEqual([{ type: 'rep', count: 1 }]); // one long press, one rep
  });

  it('rejects a rep that comes within 0.6 s of the previous one', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, pad([[0, 200], [1, 200], [0, 200], [1, 200], [0, 300]]));

    expect(events).toEqual([
      { type: 'rep', count: 1 },
      { type: 'rep.rejected', reason: 'too fast' },
    ]);
  });

  it('accepts reps exactly 0.6 s apart', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, pad([[0, 200], [1, 200], [0, 400], [1, 200], [0, 300]]));

    expect(types(events)).toEqual(['rep', 'rep']);
  });

  it('ignores a press held longer than 3 s (resting on the pad)', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, pad([[0, 200], [1, MAX_HOLD_MS + 200], [0, 300], [1, 300], [0, 300]]));

    expect(events).toEqual([{ type: 'rep', count: 1 }]); // only the normal rep after resting
  });

  it('ignores readings without a pad field (e.g. phone accel)', () => {
    const counter = new PadPushupCounter();

    const events = feed(counter, [{ t: 0, source: 'phone', ax: 0, ay: 1, az: 0 }]);

    expect(events).toEqual([]);
  });

  it('drops a half-seen press when the Home Base reboots (t goes backwards)', () => {
    const counter = new PadPushupCounter();

    feed(counter, pad([[0, 200], [1, 300]], 10_000));
    const events = feed(counter, pad([[0, 300]], 0));

    expect(events).toEqual([]);
  });
});
