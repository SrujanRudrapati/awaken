import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../engine/agents/voice', () => ({ startVoice: vi.fn() }));

import { publish, resetBus } from '../../../lib/bus';
import { GET, HEARTBEAT_MS } from './route';

async function open() {
  const abort = new AbortController();
  const response = await GET(new Request('http://x/api/stream', { signal: abort.signal }));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += decoder.decode(value);
    }
  };
  void pump();
  return { response, read: () => text, close: () => abort.abort() };
}

describe('GET /api/stream', () => {
  beforeEach(() => {
    resetBus();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('is unbuffered: no-transform headers and a ≥2 KB first chunk so tunnels flush at once', async () => {
    const s = await open();
    await vi.advanceTimersByTimeAsync(10);

    expect(s.response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(s.response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(s.read().length).toBeGreaterThanOrEqual(2048);
    s.close();
  });

  it('sends a heartbeat every 10 s and an id: line with each event', async () => {
    expect(HEARTBEAT_MS).toBe(10_000);
    const s = await open();

    publish({ type: 'voice', text: 'Watch.', eventType: 'daily' });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 10);

    expect(s.read()).toContain('id: 1\ndata: {"type":"voice"');
    expect(s.read()).toContain(': ping\n\n');
    s.close();
  });
});
