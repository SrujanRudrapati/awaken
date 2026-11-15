/** GET /api/leaderboard — top 10 hunters by XP (Tiger Data). */
import { connection } from 'next/server';
import { fail, ok } from '../../../lib/api-response';
import { leaderboard } from '../../../lib/db';

export async function GET(): Promise<Response> {
  await connection();
  try {
    return ok({ players: await leaderboard() });
  } catch (error) {
    console.error('[leaderboard] query failed', error);
    return fail(503, 'Leaderboard unavailable');
  }
}
