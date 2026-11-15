/**
 * POST /api/health — Apple Health totals from the iPhone Shortcut "Sync with System".
 * Header `X-Sync-Token: <SYNC_TOKEN>` (401 otherwise). Body: HealthSyncSchema
 * `{ playerId?, date?, steps?, distanceKm?, activeKcal?, workoutMinutes?, sleepHours?, avgHeartRate? }`.
 * playerId falls back to HEALTH_PLAYER_ID. Completes matching run/steps/workout/sleep quests.
 */
import '../../../engine/quests'; // registers the engine with the router
import { syncHealth } from '../../../engine/health';
import { fail, ok } from '../../../lib/api-response';
import { HealthSyncSchema } from '../../../lib/schemas';
import { requireSyncToken } from '../_lib/auth';
import { errorResponse, parseJson } from '../_lib/http';

export async function POST(request: Request): Promise<Response> {
  const denied = requireSyncToken(request);
  if (denied) return denied;
  const body = await parseJson(request, HealthSyncSchema);
  if (!body.ok) return body.response;

  const playerId = body.data.playerId ?? process.env.HEALTH_PLAYER_ID;
  if (!playerId) return fail(400, 'playerId missing (send it in the body or set HEALTH_PLAYER_ID)');
  try {
    const result = await syncHealth(playerId, body.data);
    return ok({
      playerId,
      completed: result.completed.map((q) => ({ id: q.id, title: q.title, xp: q.xp })),
      progressed: result.progressed.map((q) => ({ id: q.id, title: q.title, progress: q.progress, target: q.target })),
      leveledUp: result.leveledUp,
    });
  } catch (error) {
    return errorResponse(error, 'health');
  }
}
