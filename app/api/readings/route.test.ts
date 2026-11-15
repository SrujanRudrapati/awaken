import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../engine/router', () => ({ routeReading: vi.fn() }));

import { routeReading } from '../../../engine/router';
import { subscribe } from '../../../lib/bus';
import type { StreamEvent } from '../../../lib/schemas';
import { POST, resetReadingThrottle } from './route';

const reading = {
  t: 1, source: 'homebase', pad: 0, jail: 0, btn: 0, light: 500, snd: 100,
};

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/readings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function collectReadings(): { events: StreamEvent[]; off: () => void } {
  const events: StreamEvent[] = [];
  const off = subscribe((e) => {
    if (e.type === 'reading') events.push(e);
  });
  return { events, off };
}

describe('POST /api/readings', () => {
  beforeEach(() => {
    vi.mocked(routeReading).mockClear();
    resetReadingThrottle();
  });

  it('accepts a single reading, publishes it and routes it', async () => {
    const { events, off } = collectReadings();

    const res = await POST(post(reading));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { accepted: 1 }, error: null });
    expect(events).toEqual([{ type: 'reading', reading }]);
    expect(routeReading).toHaveBeenCalledWith(reading);
    off();
  });

  it('routes every reading in a batch but throttles reading events to 10/s', async () => {
    const { events, off } = collectReadings();
    const batch = Array.from({ length: 25 }, (_, i) => ({ ...reading, t: i * 10 }));

    const res = await POST(post(batch));

    expect(res.status).toBe(200);
    expect(routeReading).toHaveBeenCalledTimes(25);
    expect(events.length).toBe(1); // all arrived within the same 100 ms window
    off();
  });

  it('publishes again once the throttle window has passed', async () => {
    vi.useFakeTimers();
    const { events, off } = collectReadings();

    await POST(post(reading));
    vi.advanceTimersByTime(100);
    await POST(post(reading));

    expect(events.length).toBe(2);
    off();
    vi.useRealTimers();
  });

  it('rejects invalid readings with 400 and routes nothing', async () => {
    const res = await POST(post({ ...reading, jail: 2 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/jail/);
    expect(routeReading).not.toHaveBeenCalled();
  });

  it('defaults source to homebase (raw firmware JSON) and strips unknown fields', async () => {
    const res = await POST(post({ t: 5, pad: 1, dist: 40, touch: 1 }));

    expect(res.status).toBe(200);
    expect(routeReading).toHaveBeenCalledWith({ t: 5, source: 'homebase', pad: 1 });
  });

  it('accepts phone accel readings', async () => {
    const phone = { t: 5, source: 'phone', ax: 0.1, ay: -0.9, az: 0.2 };

    const res = await POST(post(phone));

    expect(res.status).toBe(200);
    expect(routeReading).toHaveBeenCalledWith(phone);
  });

  it('rejects an unknown source', async () => {
    const res = await POST(post({ t: 5, source: 'toaster' }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await POST(post('{not json', true));
    expect(res.status).toBe(400);
  });

  it('rejects an empty array', async () => {
    const res = await POST(post([]));
    expect(res.status).toBe(400);
  });
});
