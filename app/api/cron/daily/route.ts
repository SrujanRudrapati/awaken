/**
 * POST /api/cron/daily — midnight drop (Maritime cron). Fails missed quests (Penalty Zone)
 * and drops today's quests for every player. If CRON_SECRET is set, requires
 * `Authorization: Bearer <CRON_SECRET>`.
 */
import { timingSafeEqual } from 'node:crypto';
import { dailyDrop } from '../../../../engine/quests';
import { fail, ok } from '../../../../lib/api-response';
import { errorResponse } from '../../_lib/http';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return fail(401, 'Unauthorized');
  try {
    const dropped = await dailyDrop();
    const counts = Object.fromEntries(Object.entries(dropped).map(([id, quests]) => [id, quests.length]));
    return ok({ players: Object.keys(dropped).length, quests: counts });
  } catch (error) {
    return errorResponse(error, 'cron/daily');
  }
}
