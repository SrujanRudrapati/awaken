/** POST /api/read/trial — `{ playerId, questId }` → 3 timed questions on what was read (after the Phone Jail time). */
import { z } from 'zod';
import { startReadingTrial } from '../../../../engine/agents/readingTrial';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.object({ playerId: PlayerIdSchema, questId: z.string().min(1).max(64) });

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    return ok(await startReadingTrial(body.data.playerId, body.data.questId));
  } catch (error) {
    return errorResponse(error, 'read/trial');
  }
}
