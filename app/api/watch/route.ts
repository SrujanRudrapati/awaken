/**
 * POST /api/watch — the Apple Watch app reports reps it counted on-device.
 * Header `X-Sync-Token: <SYNC_TOKEN>` (401 otherwise).
 * Body `{ playerId, event: 'rep' | 'quest.complete', exercise, count }` where `count` is the Watch's
 * cumulative rep count for the current quest (so lost or repeated posts self-correct).
 * Reps go through the router as source 'watch' → `rep` / `quest.complete` / XP like any sensor.
 */
import { z } from 'zod';
import '../../../engine/quests'; // registers the engine as the router's completion handler
import { applyWatchReps } from '../../../engine/router';
import { fail, ok } from '../../../lib/api-response';
import { requireSyncToken } from '../_lib/auth';
import { PlayerIdSchema, parseJson } from '../_lib/http';

const MAX_COUNT = 10_000;

const BodySchema = z.object({
  playerId: PlayerIdSchema,
  event: z.enum(['rep', 'quest.complete']),
  exercise: z.enum(['pushup', 'squat', 'jumpingjack', 'situp', 'punch']),
  count: z.number().int().min(0).max(MAX_COUNT),
});

export async function POST(request: Request): Promise<Response> {
  const denied = requireSyncToken(request);
  if (denied) return denied;
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;

  const { playerId, exercise, count } = body.data;
  const result = applyWatchReps(playerId, exercise, count);
  if (!result.ok) return fail(409, result.reason);
  return ok(result);
}
