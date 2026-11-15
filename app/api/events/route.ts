/**
 * GET /api/events?since=<id> — polling fallback for GET /api/stream, for networks that buffer SSE
 * (e.g. a cloudflared quick tunnel). Returns the kept events after `since` (same JSON as the stream
 * frames, plus `id`) and `lastId` to send next time. Raw `reading` events are not included.
 */
import { connection } from 'next/server';
import { z } from 'zod';
import { fail, ok } from '../../../lib/api-response';
import { eventsSince } from '../../../lib/bus';
import { withMood } from '../../../lib/irisMood';

const SinceSchema = z.coerce.number().int().min(0).default(0);

export async function GET(request: Request): Promise<Response> {
  await connection();
  const raw = new URL(request.url).searchParams.get('since');
  const since = SinceSchema.safeParse(raw ?? undefined);
  if (!since.success) return fail(400, 'since must be a non-negative integer event id');
  const { events, lastId } = eventsSince(since.data);
  return ok({ events: events.map(({ id, event }) => ({ id, ...withMood(event) })), lastId });
}
