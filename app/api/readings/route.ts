/**
 * POST /api/readings[?sessionId=<id>] — bridge/simulator/phone sends one Reading or a batch.
 * Phone/Watch readings count only with the sessionId their vow start returned; Home Base readings need none.
 * Auth: SYNC_TOKEN (X-Sync-Token / Bearer — the bridge and simulator send it). The one exception is
 * a phone/Watch-only batch with a sessionId (the /hunter page can't hold a secret): it can only count toward that vow.
 * Every reading goes to the engine; `reading` SSE events are throttled to 10/s
 * so the UI isn't flooded.
 */
import { z } from 'zod';
import '../../../engine/quests'; // registers the engine as the router's completion handler
import { routeReading } from '../../../engine/router';
import { recordLight } from '../../../lib/homebaseLight';
import { fail, ok } from '../../../lib/api-response';
import { publish } from '../../../lib/bus';
import { ReadingSchema, SessionIdSchema, type Reading } from '../../../lib/schemas';
import { hasSyncToken } from '../_lib/auth';

const MAX_BATCH = 50;
const PUBLISH_INTERVAL_MS = 100; // 10 events/s

const BatchSchema = z.array(ReadingSchema).min(1).max(MAX_BATCH);

const throttle = globalThis as typeof globalThis & { __awakenLastReadingPublish?: number };

/** Test hook: reset the throttle window. */
export function resetReadingThrottle(): void {
  throttle.__awakenLastReadingPublish = undefined;
}

function shouldPublish(now: number): boolean {
  const last = throttle.__awakenLastReadingPublish;
  if (last !== undefined && now - last < PUBLISH_INTERVAL_MS) return false;
  throttle.__awakenLastReadingPublish = now;
  return true;
}

/**
 * SYNC_TOKEN (bridge, simulator — both send it), or a phone/Watch-only batch tagged with its vow's
 * sessionId. There is no "same machine" pass: Next keeps a client-sent X-Forwarded-For, so anyone on
 * the venue Wi-Fi could claim to be 127.0.0.1.
 */
function isAllowed(request: Request, readings: readonly Reading[], sessionId: string | undefined): boolean {
  if (hasSyncToken(request)) return true;
  return sessionId !== undefined && readings.every((r) => r.source !== 'homebase');
}

export async function POST(request: Request): Promise<Response> {
  const rawSession = new URL(request.url).searchParams.get('sessionId');
  const session = rawSession === null ? undefined : SessionIdSchema.safeParse(rawSession);
  if (session && !session.success) return fail(400, 'sessionId is not a valid session id');
  const sessionId = session?.data;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Body must be valid JSON');
  }

  // Pick the schema by shape (not z.union) so errors name the offending field.
  const parsed = Array.isArray(body) ? BatchSchema.safeParse(body) : ReadingSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, z.prettifyError(parsed.error));
  }

  const readings = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (!isAllowed(request, readings, sessionId)) {
    return fail(401, 'Home Base readings need X-Sync-Token (or must come from this machine); phone/Watch readings need ?sessionId=');
  }

  for (const reading of readings) {
    recordLight(reading); // dark-room minutes confirm Watch "lights out" vows
    try {
      routeReading(reading, sessionId);
    } catch (error) {
      console.error('[readings] router failed', error);
    }
  }

  // Publish the newest reading of the batch if the throttle window allows.
  if (shouldPublish(Date.now())) {
    publish({ type: 'reading', reading: readings[readings.length - 1] });
  }

  return ok({ accepted: readings.length });
}
