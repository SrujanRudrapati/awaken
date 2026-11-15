import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const poolOptions: unknown[] = [];
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolOptions.push(options);
    }
    query = queryMock;
    on = vi.fn();
  },
}));

import type { Player } from './schemas';
import {
  connectionStringWithoutSslMode,
  getPlayer,
  leaderboard,
  logEvent,
  resetDb,
  rowToPlayer,
  statHistory,
  updatePlayer,
  upsertPlayer,
  type PlayerPatch,
} from './db';

const URL_WITH_SSL = 'postgres://u:p@host.tsdb.cloud:5432/tsdb?sslmode=require';

const player: Player = {
  id: 'p1',
  name: 'Jin',
  rank: 'E',
  level: 2,
  xp: 60,
  stats: { STR: 1, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 },
  penalty: false,
};
const row = { ...player, stats: { STR: 1 } };

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('db', () => {
  beforeEach(() => {
    resetDb();
    queryMock.mockReset();
    poolOptions.length = 0;
    process.env.TIGER_DATABASE_URL = URL_WITH_SSL;
  });
  afterEach(() => {
    delete process.env.TIGER_DATABASE_URL;
  });

  it('strips sslmode from the URL and sets ssl rejectUnauthorized:false', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await getPlayer('p1');

    expect(poolOptions[0]).toMatchObject({
      connectionString: 'postgres://u:p@host.tsdb.cloud:5432/tsdb',
      ssl: { rejectUnauthorized: false },
    });
    expect(connectionStringWithoutSslMode(URL_WITH_SSL)).not.toMatch(/sslmode/);
  });

  it('is a no-op without TIGER_DATABASE_URL', async () => {
    delete process.env.TIGER_DATABASE_URL;

    expect(await getPlayer('p1')).toBeNull();
    expect(await leaderboard()).toEqual([]);
    expect(await statHistory('p1')).toEqual([]);
    logEvent({ playerId: 'p1', kind: 'rep', source: 'homebase' });
    await flush();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('upsertPlayer sends stats as JSON with ON CONFLICT', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await upsertPlayer(player);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(params).toEqual(['p1', 'Jin', 'E', 2, 60, JSON.stringify(player.stats), false]);
  });

  it('getPlayer fills missing stats with 0', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    expect(await getPlayer('p1')).toEqual(player);
  });

  it('updatePlayer only sets whitelisted fields, parameterised', async () => {
    queryMock.mockResolvedValue({ rows: [{ ...row, xp: 100 }] });

    const hostile = { xp: 100, level: 3, 'id; DROP TABLE players': 1 } as unknown as PlayerPatch;
    const updated = await updatePlayer('p1', hostile);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE players SET xp = \$2, level = \$3 WHERE id = \$1/);
    expect(sql).not.toMatch(/DROP/);
    expect(params).toEqual(['p1', 100, 3]);
    expect(updated?.xp).toBe(100);
  });

  it('logEvent inserts with defaults and swallows failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockRejectedValue(new Error('connection refused'));

    expect(() => logEvent({ playerId: 'p1', kind: 'xp', stat: 'STR', value: 30, source: 'engine' })).not.toThrow();
    logEvent({ playerId: 'p1', kind: 'xp', source: 'engine' });
    await flush();

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO events/);
    expect(params.slice(1)).toEqual(['p1', 'STR', 'xp', 30, true, 'engine']);
    expect(error).toHaveBeenCalledTimes(1); // once per outage
    error.mockRestore();
  });

  it('leaderboard returns compact rows in query order', async () => {
    queryMock.mockResolvedValue({ rows: [{ ...row, id: 'a', xp: 900 }, row] });

    expect(await leaderboard(10)).toEqual([
      { id: 'a', name: 'Jin', rank: 'E', level: 2, xp: 900 },
      { id: 'p1', name: 'Jin', rank: 'E', level: 2, xp: 60 },
    ]);
    expect(queryMock.mock.calls[0][1]).toEqual([10]);
  });

  it('statHistory maps daily_xp rows and drops unknown stats', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { day: new Date('2026-11-13T00:00:00Z'), stat: 'STR', xp: '45' },
        { day: new Date('2026-11-14T00:00:00Z'), stat: 'BOGUS', xp: 1 },
      ],
    });

    expect(await statHistory('p1', 7)).toEqual([{ day: '2026-11-13', stat: 'STR', xp: 45 }]);
    expect(queryMock.mock.calls[0][1]).toEqual(['p1', 7]);
  });

  it('rowToPlayer rejects corrupt rows', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(rowToPlayer({ ...row, rank: 'Z' })).toBeNull();
    error.mockRestore();
  });
});
