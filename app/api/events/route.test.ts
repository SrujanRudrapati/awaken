import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));

import { publish, resetBus } from '../../../lib/bus';
import { GET } from './route';

const call = async (query: string) => (await GET(new Request(`http://x/api/events${query}`))).json();

describe('GET /api/events (polling fallback for /api/stream)', () => {
  beforeEach(() => resetBus());

  it('returns events after `since` with id and irisMood, plus lastId', async () => {
    publish({ type: 'voice', text: 'One.', eventType: 'daily' });
    publish({ type: 'penalty', playerId: 'p1', reason: 'late' });

    const body = await call('?since=1');

    expect(body.data.lastId).toBe(2);
    expect(body.data.events).toEqual([{ id: 2, type: 'penalty', playerId: 'p1', reason: 'late', irisMood: 'furious' }]);
  });

  it('since defaults to 0; a bad value is a 400', async () => {
    publish({ type: 'voice', text: 'One.', eventType: 'daily' });
    expect((await call('')).data.events).toHaveLength(1);
    expect((await GET(new Request('http://x/api/events?since=abc'))).status).toBe(400);
  });
});
