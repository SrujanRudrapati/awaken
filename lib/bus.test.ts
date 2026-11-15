import { describe, expect, it, vi } from 'vitest';
import { publish, subscribe } from './bus';
import type { StreamEvent } from './schemas';

const voice: StreamEvent = { type: 'voice', text: 'You have been chosen.', eventType: 'onboard' };

describe('bus', () => {
  it('delivers published events to subscribers', () => {
    const fn = vi.fn();
    const unsubscribe = subscribe(fn);

    publish(voice);

    expect(fn).toHaveBeenCalledWith(voice);
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

    expect(good).toHaveBeenCalledWith(voice);
    offBad();
    offGood();
    errorSpy.mockRestore();
  });
});
