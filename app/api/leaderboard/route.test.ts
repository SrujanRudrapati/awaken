import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../lib/db', () => ({ weeklyLeaderboard: vi.fn() }));
vi.mock('../../../engine/quests', () => ({ listPlayersInMemory: vi.fn().mockReturnValue([]) }));

import { recordProof, resetLedger } from '../../../engine/ledger';
import { listPlayersInMemory } from '../../../engine/quests';
import { weeklyLeaderboard } from '../../../lib/db';
import { GET } from './route';

const req = (query = '') => new Request(`http://x/api/leaderboard${query}`);
const zero = { STR: 0, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 };
const live = (id: string, proof = zero) => ({ id, name: id.toUpperCase(), rank: 'E' as const, level: 1, xp: 0, penalty: false, stats: zero, proof });

describe('GET /api/leaderboard (weekly)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLedger();
    vi.mocked(listPlayersInMemory).mockReturnValue([]);
  });

  it('ranks by Proof earned this week, with rank and Power', async () => {
    vi.mocked(weeklyLeaderboard).mockResolvedValue([
      { id: 'a', name: 'A', rank: 'D', level: 3, proof: { ...zero, STR: 100 }, weeklyProof: 120 },
      { id: 'b', name: 'B', rank: 'E', level: 1, proof: null, weeklyProof: 300 },
    ]);

    const { data } = await (await GET(req())).json();

    expect(data.players.map((p: { id: string }) => p.id)).toEqual(['b', 'a']);
    expect(data.players[1]).toMatchObject({ rank: 'D', power: 10, weeklyProof: 120 });
    expect(vi.mocked(weeklyLeaderboard).mock.calls[0][1]).toBe(false); // DEMO_MODE Proof excluded by default
  });

  it('live ledger beats a lagging DB; unverified (DEMO_MODE) Proof counts only with includeDemo=1', async () => {
    vi.mocked(weeklyLeaderboard).mockResolvedValue([{ id: 'a', name: 'A', rank: 'E', level: 1, proof: null, weeklyProof: 10 }]);
    vi.mocked(listPlayersInMemory).mockReturnValue([live('a'), live('c')]);
    recordProof('a', 'A', 50, true);
    recordProof('c', 'C', 80, false);

    const strict = (await (await GET(req())).json()).data.players;
    expect(strict.map((p: { id: string; weeklyProof: number }) => [p.id, p.weeklyProof])).toEqual([['a', 50], ['c', 0]]);
    const demo = (await (await GET(req('?includeDemo=1'))).json()).data.players;
    expect(demo[0]).toMatchObject({ id: 'c', weeklyProof: 80 });
  });

  it('DB down: serves the live board, or 503 if there is nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(weeklyLeaderboard).mockRejectedValue(new Error('down'));
    expect((await GET(req())).status).toBe(503);

    vi.mocked(listPlayersInMemory).mockReturnValue([live('a')]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data.players).toHaveLength(1);
  });
});
