/**
 * POST /api/cron/daily — midnight drop (Maritime cron). Fails missed quests (Penalty Zone)
 * and drops today's quests for every player. Requires `Authorization: Bearer <CRON_SECRET>`
 * (401 otherwise, including when CRON_SECRET is unset).
 */
import { dailyDrop } from '../../../../engine/quests';
import { ok } from '../../../../lib/api-response';
import { requireCronSecret } from '../../_lib/auth';
import { errorResponse } from '../../_lib/http';

export async function POST(request: Request): Promise<Response> {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const dropped = await dailyDrop();
    const counts = Object.fromEntries(Object.entries(dropped).map(([id, quests]) => [id, quests.length]));
    return ok({ players: Object.keys(dropped).length, quests: counts });
  } catch (error) {
    return errorResponse(error, 'cron/daily');
  }
}
