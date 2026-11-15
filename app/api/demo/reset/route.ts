/**
 * POST /api/demo/reset — removes ONLY test/demo players (ids `demo-…` / `test-…`, see lib/demo.ts)
 * and their events, from memory and Tiger Data. Requires `Authorization: Bearer <CRON_SECRET>`.
 * Called by `npm run demo:reset`.
 */
import { purgePlayers } from '../../../../engine/quests';
import { ok } from '../../../../lib/api-response';
import { deleteDemoPlayers } from '../../../../lib/db';
import { isDemoPlayerId } from '../../../../lib/demo';
import { requireCronSecret } from '../../_lib/auth';
import { errorResponse } from '../../_lib/http';

export async function POST(request: Request): Promise<Response> {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const memoryPlayers = purgePlayers(isDemoPlayerId);
    const tiger = await deleteDemoPlayers();
    return ok({ memoryPlayers, tiger });
  } catch (error) {
    return errorResponse(error, 'demo/reset');
  }
}
