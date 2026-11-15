import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../../lib/db', () => ({ getPlayer: vi.fn(), statHistory: vi.fn() }));

import { getPlayer, statHistory } from '../../../../lib/db';
import type { Player } from '../../../../lib/schemas';
import { GET } from './route';

const player: Player = {
  id: 'p1', name: 'Jin', rank: 'E', level: 1, xp: 0, penalty: false,
  stats: { STR: 0, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 },
};
const call = (id: string): Promise<Response> =>
  GET(new Request(`http://x/api/player/${id}`), { params: Promise.resolve({ id }) });

describe('GET /api/player/:id', () => {
  it('returns player + history', async () => {
    vi.mocked(getPlayer).mockResolvedValue(player);
    vi.mocked(statHistory).mockResolvedValue([{ day: '2026-11-14', stat: 'STR', xp: 30 }]);

    const body = await (await call('p1')).json();

    expect(body.data).toEqual({ player, history: [{ day: '2026-11-14', stat: 'STR', xp: 30 }] });
  });

  it('404s for an unknown player', async () => {
    vi.mocked(getPlayer).mockResolvedValue(null);
    vi.mocked(statHistory).mockResolvedValue([]);

    expect((await call('nobody')).status).toBe(404);
  });
});
