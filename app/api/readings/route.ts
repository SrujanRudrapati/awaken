/**
 * POST /api/readings — bridge/simulator sends one Reading or a batch.
 * Every reading goes to the engine; `reading` SSE events are throttled to 10/s
 * so the UI isn't flooded.
 */
import { z } from 'zod';
import '../../../engine/quests'; // registers the engine as the router's completion handler
import { routeReading } from '../../../engine/router';
import { fail, ok } from '../../../lib/api-response';
import { publish } from '../../../lib/bus';
import { ReadingSchema } from '../../../lib/schemas';

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

export async function POST(request: Request): Promise<Response> {
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

  for (const reading of readings) {
    try {
      routeReading(reading);
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
