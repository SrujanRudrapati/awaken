/**
 * GET /api/leaderboard — top 10 hunters by XP.
 * Tiger Data rows, overlaid with the engine's in-memory players (fresher: DB writes are
 * fire-and-forget), so a just-finished quest shows up immediately and the board works offline.
 */
import { connection } from 'next/server';
import { listPlayersInMemory } from '../../../engine/quests';
import { fail, ok } from '../../../lib/api-response';
import { leaderboard, type LeaderboardRow } from '../../../lib/db';

const LEADERBOARD_SIZE = 10;

function mergeRows(stored: readonly LeaderboardRow[], live: readonly LeaderboardRow[]): LeaderboardRow[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  live.forEach((row) => byId.set(row.id, row));
  return [...byId.values()].sort((a, b) => b.xp - a.xp).slice(0, LEADERBOARD_SIZE);
}

export async function GET(): Promise<Response> {
  await connection();
  const live = listPlayersInMemory().map(({ id, name, rank, level, xp }) => ({ id, name, rank, level, xp }));
  try {
    return ok({ players: mergeRows(await leaderboard(), live) });
  } catch (error) {
    console.error('[leaderboard] query failed', error);
    if (live.length > 0) return ok({ players: mergeRows([], live) });
    return fail(503, 'Leaderboard unavailable');
  }
}
