import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../lib/db', () => ({ leaderboard: vi.fn() }));
vi.mock('../../../engine/quests', () => ({ listPlayersInMemory: vi.fn().mockReturnValue([]) }));

import { listPlayersInMemory } from '../../../engine/quests';
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

  const live = (id: string, xp: number) => ({
    id, name: id.toUpperCase(), rank: 'E' as const, level: 1, xp, penalty: false,
    stats: { STR: 0, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 },
  });

  it('overlays fresher in-memory players on the DB rows and re-sorts', async () => {
    vi.mocked(leaderboard).mockResolvedValue([
      { id: 'a', name: 'A', rank: 'E', level: 1, xp: 50 },
      { id: 'b', name: 'B', rank: 'E', level: 1, xp: 40 },
    ]);
    vi.mocked(listPlayersInMemory).mockReturnValueOnce([live('b', 90), live('c', 10)]);

    const { data } = await (await GET()).json();

    expect(data.players.map((p: { id: string; xp: number }) => [p.id, p.xp])).toEqual([['b', 90], ['a', 50], ['c', 10]]);
  });

  it('serves in-memory players when the DB fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(leaderboard).mockRejectedValue(new Error('down'));
    vi.mocked(listPlayersInMemory).mockReturnValueOnce([live('a', 5)]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).data.players).toHaveLength(1);
  });
});
