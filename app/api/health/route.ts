/**
 * POST /api/health — Apple Health from the iPhone Shortcut. Header `X-Sync-Token: <SYNC_TOKEN>`
 * (401 otherwise). Two bodies:
 *   totals  `{ playerId?, date?, steps?, distanceKm?, activeKcal?, workoutMinutes?, sleepHours?, avgHeartRate? }`
 *           → completes matching run/steps/workout/sleep vows.
 *   sleep   `{ "type": "sleep", playerId?, samples: [{ start, end, stage }] }` (Apple Watch Sleep Analysis;
 *           stage InBed|Awake|Core|Deep|REM|Asleep, any case; idempotent by start+end+stage)
 *           → nights, sleep vows judged, morning `sleep.summary`.
 * playerId falls back to HEALTH_PLAYER_ID.
 */
import { z } from 'zod';
import '../../../engine/quests'; // registers the engine with the router
import { syncHealth } from '../../../engine/health';
import { syncSleep } from '../../../engine/sleepSync';
import { fail, ok } from '../../../lib/api-response';
import { HealthSyncSchema, SleepSyncSchema } from '../../../lib/schemas';
import { requireSyncToken } from '../_lib/auth';
import { errorResponse } from '../_lib/http';

function isSleepBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && String((body as { type?: unknown }).type ?? '').toLowerCase() === 'sleep';
}

async function handleSleep(body: unknown): Promise<Response> {
  const parsed = SleepSyncSchema.safeParse(body);
  if (!parsed.success) return fail(400, z.prettifyError(parsed.error));
  const playerId = parsed.data.playerId ?? process.env.HEALTH_PLAYER_ID;
  if (!playerId) return fail(400, 'playerId missing (send it in the body or set HEALTH_PLAYER_ID)');
  const result = await syncSleep(playerId, parsed.data.samples);
  return ok({
    playerId,
    added: result.added,
    lastNight: result.lastNight,
    vows: result.verdicts,
    announced: result.announced,
  });
}

async function handleTotals(body: unknown): Promise<Response> {
  const parsed = HealthSyncSchema.safeParse(body);
  if (!parsed.success) return fail(400, z.prettifyError(parsed.error));
  const playerId = parsed.data.playerId ?? process.env.HEALTH_PLAYER_ID;
  if (!playerId) return fail(400, 'playerId missing (send it in the body or set HEALTH_PLAYER_ID)');
  const result = await syncHealth(playerId, parsed.data);
  return ok({
    playerId,
    completed: result.completed.map((q) => ({ id: q.id, title: q.title, xp: q.xp })),
    progressed: result.progressed.map((q) => ({ id: q.id, title: q.title, progress: q.progress, target: q.target })),
    leveledUp: result.leveledUp,
  });
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireSyncToken(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Body must be valid JSON');
  }
  try {
    return await (isSleepBody(body) ? handleSleep(body) : handleTotals(body));
  } catch (error) {
    return errorResponse(error, 'health');
  }
}
