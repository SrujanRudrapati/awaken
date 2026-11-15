import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../lib/db', () => ({ leaderboard: vi.fn() }));

import { leaderboard } from '../../../lib/db';
import { GET } from './route';

describe('GET /api/leaderboard', () => {
  it('returns the top players', async () => {
    vi.mocked(leaderboard).mockResolvedValue([{ id: 'a', name: 'A', rank: 'D', level: 3, xp: 120 }]);

    const res = await GET();

    expect(await res.json()).toEqual({
      success: true,
      data: { players: [{ id: 'a', name: 'A', rank: 'D', level: 3, xp: 120 }] },
      error: null,
    });
  });

  it('returns 503 when the DB fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(leaderboard).mockRejectedValue(new Error('down'));

    expect((await GET()).status).toBe(503);
  });
});
