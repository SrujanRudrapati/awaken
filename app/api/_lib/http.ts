/** Shared helpers for API routes: JSON body validation and engine error mapping. */
import { z } from 'zod';
import { QuestError } from '../../../engine/quests';
import { fail } from '../../../lib/api-response';

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Reads and validates a JSON body; on failure returns a ready 400 response. */
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: fail(400, 'Body must be valid JSON') };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: fail(400, z.prettifyError(parsed.error)) };
  return { ok: true, data: parsed.data };
}

/** QuestError → its status; anything else → logged 500. */
export function errorResponse(error: unknown, context: string): Response {
  if (error instanceof QuestError) return fail(error.status, error.message);
  console.error(`[${context}]`, error);
  return fail(500, 'Internal error');
}

export const PlayerIdSchema = z.string().min(1).max(64);
