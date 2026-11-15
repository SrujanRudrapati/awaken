/**
 * Polling fallback for /api/stream: when SSE is silent for SSE_SILENCE_MS (e.g. a tunnel buffers it),
 * the client polls GET /api/events?since=<lastId> every POLL_INTERVAL_MS. Pure helpers, so they're testable.
 */
import { StreamEventSchema, type StreamEvent } from '../../lib/schemas';

export const SSE_SILENCE_MS = 5_000;
export const POLL_INTERVAL_MS = 1_000;

export interface PollBody {
  events: ({ id: number } & Record<string, unknown>)[];
  lastId: number;
}

export function shouldPoll(lastSseAt: number, now: number): boolean {
  return now - lastSseAt >= SSE_SILENCE_MS;
}

/**
 * Next position plus the events to hand on. `lastId === null` (never polled, no SSE id seen) and a
 * server restart (its lastId went backwards) only set the position: screens load current state over REST.
 */
export function applyPoll(lastId: number | null, body: PollBody): { lastId: number; deliver: StreamEvent[] } {
  if (lastId === null || body.lastId < lastId) return { lastId: body.lastId, deliver: [] };
  const deliver = body.events
    .filter((e) => e.id > lastId)
    .sort((a, b) => a.id - b.id)
    .flatMap((e) => {
      const parsed = StreamEventSchema.safeParse(e); // zod strips the extra `id`
      return parsed.success ? [parsed.data] : [];
    });
  return { lastId: Math.max(lastId, body.lastId), deliver };
}
