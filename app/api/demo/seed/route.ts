/**
 * POST /api/demo/seed — `{ playerId }` → 9 demo profiles just above that person on this week's
 * leaderboard (`npm run demo:seed-others`). Requires `Authorization: Bearer <CRON_SECRET>`.
 */
import { z } from 'zod';
import { seedOthers } from '../../../../engine/demo/seedOthers';
import { ok } from '../../../../lib/api-response';
import { requireCronSecret } from '../../_lib/auth';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.object({ playerId: PlayerIdSchema });

export async function POST(request: Request): Promise<Response> {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    return ok(await seedOthers(body.data.playerId));
  } catch (error) {
    return errorResponse(error, 'demo/seed');
  }
}
