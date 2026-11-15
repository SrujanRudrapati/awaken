/**
 * GET /api/leaderboard[?includeDemo=1] — this week's board: Proof earned in the last 7 days
 * (verified events only; Proof earned in DEMO_MODE is excluded unless includeDemo=1), with
 * each person's rank and Power. Tiger rows overlaid with the live in-memory ledger (DB writes
 * are fire-and-forget), so a just-kept vow shows up immediately and the board works offline.
 */
import { connection } from 'next/server';
import { weeklyBoard } from '../../../engine/ledger';
import { listPlayersInMemory } from '../../../engine/quests';
import { fail, ok } from '../../../lib/api-response';
import { weeklyLeaderboard } from '../../../lib/db';
import { power, proofOf } from '../../../lib/power';
import type { Rank } from '../../../lib/schemas';

const LEADERBOARD_SIZE = 10;

interface BoardRow {
  id: string;
  name: string;
  rank: Rank;
  level: number;
  power: number;
  weeklyProof: number;
}

function merge(stored: readonly BoardRow[], includeDemo: boolean): BoardRow[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  const weekly = new Map(weeklyBoard(includeDemo).map((row) => [row.id, row.weeklyProof]));
  for (const player of listPlayersInMemory()) {
    const fromDb = byId.get(player.id)?.weeklyProof ?? 0;
    byId.set(player.id, {
      id: player.id,
      name: player.name,
      rank: player.rank,
      level: player.level,
      power: power(proofOf(player)),
      weeklyProof: Math.max(fromDb, weekly.get(player.id) ?? 0), // memory may be partial after a restart; DB may lag
    });
  }
  return [...byId.values()].sort((a, b) => b.weeklyProof - a.weeklyProof || b.power - a.power).slice(0, LEADERBOARD_SIZE);
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  const includeDemo = new URL(request.url).searchParams.get('includeDemo') === '1';
  try {
    const stored = (await weeklyLeaderboard(LEADERBOARD_SIZE * 3, includeDemo)) ?? [];
    const rows = stored.map((r) => ({
      id: r.id,
      name: r.name,
      rank: r.rank as Rank,
      level: r.level,
      power: power(proofOf({ proof: r.proof ?? undefined })),
      weeklyProof: r.weeklyProof,
    }));
    return ok({ week: 'last 7 days', includeDemo, players: merge(rows, includeDemo) });
  } catch (error) {
    console.error('[leaderboard] query failed', error);
    const live = merge([], includeDemo);
    if (live.length > 0) return ok({ week: 'last 7 days', includeDemo, players: live });
    return fail(503, 'Leaderboard unavailable');
  }
}
