import { describe, expect, it, vi } from 'vitest';
import { publish, subscribe } from './bus';
import type { StreamEvent } from './schemas';

const voice: StreamEvent = { type: 'voice', text: 'You have been chosen.', eventType: 'onboard' };

describe('bus', () => {
  it('delivers published events to subscribers', () => {
    const fn = vi.fn();
    const unsubscribe = subscribe(fn);

    publish(voice);

    expect(fn).toHaveBeenCalledWith(voice, expect.any(Number));
    unsubscribe();
  });

  it('stops delivering after unsubscribe', () => {
    const fn = vi.fn();
    const unsubscribe = subscribe(fn);

    unsubscribe();
    publish(voice);

    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects events that do not match StreamEventSchema', () => {
    const bad = { type: 'voice', text: '' } as unknown as StreamEvent;
    expect(() => publish(bad)).toThrow();
  });

  it('keeps delivering to other subscribers when one throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offBad = subscribe(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offGood = subscribe(good);

    publish(voice);

    expect(good).toHaveBeenCalledWith(voice, expect.any(Number));
    offBad();
    offGood();
    errorSpy.mockRestore();
  });
});

describe('event log (polling fallback)', () => {
  it('numbers events and replays the ones after `since`, without raw readings', async () => {
    const { eventsSince, resetBus } = await import('./bus');
    resetBus();
    const seen: number[] = [];
    const off = subscribe((_e, id) => seen.push(id));

    publish(voice);
    publish({ type: 'reading', reading: { t: 1, source: 'homebase', pad: 1 } });
    publish({ ...voice, text: 'Again.' });
    off();

    expect(seen).toEqual([1, 2, 3]);
    const { events, lastId } = eventsSince(1);
    expect(lastId).toBe(3);
    expect(events).toEqual([{ id: 3, event: { ...voice, text: 'Again.' } }]);
  });

  it('replays everything kept when `since` is ahead of the server (it restarted)', async () => {
    const { eventsSince, resetBus } = await import('./bus');
    resetBus();
    publish(voice);

    expect(eventsSince(9_999).events.map((e) => e.id)).toEqual([1]);
  });

  it('keeps only the newest EVENT_LOG_SIZE events', async () => {
    const { EVENT_LOG_SIZE, eventsSince, resetBus } = await import('./bus');
    resetBus();
    for (let i = 0; i < EVENT_LOG_SIZE + 5; i++) publish(voice);

    const { events } = eventsSince(0);
    expect(events).toHaveLength(EVENT_LOG_SIZE);
    expect(events[0].id).toBe(6);
  });
});

describe('hot reload', () => {
  it('adopts an older bare-emitter bus left on globalThis, keeping its subscribers', async () => {
    const { EventEmitter } = await import('node:events');
    const legacy = new EventEmitter();
    const old = vi.fn();
    legacy.on('event', old);
    (globalThis as { __awakenBus?: unknown }).__awakenBus = legacy;

    publish(voice);

    expect(old).toHaveBeenCalledWith(voice, 1);
  });
});
