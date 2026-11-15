import { describe, expect, it } from 'vitest';
import { SSE_SILENCE_MS, applyPoll, shouldPoll } from './eventPolling';

const voice = (id: number) => ({ id, type: 'voice', text: `Line ${id}.`, eventType: 'daily', irisMood: 'watching' });

describe('/api/events polling fallback', () => {
  it('polls only after SSE has been silent for 5 s', () => {
    expect(SSE_SILENCE_MS).toBe(5_000);
    expect(shouldPoll(1_000, 5_999)).toBe(false);
    expect(shouldPoll(1_000, 6_000)).toBe(true);
  });

  it('first poll only learns the position (no replay of old history)', () => {
    expect(applyPoll(null, { events: [voice(1), voice(2)], lastId: 2 })).toEqual({ lastId: 2, deliver: [] });
  });

  it('delivers new events once, in order, skipping ones SSE already delivered', () => {
    const { lastId, deliver } = applyPoll(2, { events: [voice(2), voice(3), voice(4)], lastId: 4 });

    expect(lastId).toBe(4);
    expect(deliver.map((e) => e.type === 'voice' && e.text)).toEqual(['Line 3.', 'Line 4.']);
  });

  it('a server restart (lastId went backwards) resets the position without replaying', () => {
    expect(applyPoll(40, { events: [voice(1)], lastId: 1 })).toEqual({ lastId: 1, deliver: [] });
  });

  it('drops malformed events', () => {
    expect(applyPoll(0, { events: [{ id: 1, type: 'nope' }], lastId: 1 }).deliver).toEqual([]);
  });
});
