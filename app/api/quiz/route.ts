/** POST /api/quiz — `{ playerId, questId, topic? }` → 3 questions (no answers) for an active quiz quest. */
import { z } from 'zod';
import { startQuiz } from '../../../engine/agents/quiz';
import { ok } from '../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../_lib/http';

const BodySchema = z.object({
  playerId: PlayerIdSchema,
  questId: z.string().min(1).max(64),
  topic: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const { playerId, questId, topic } = body.data;
    return ok({ questId, questions: await startQuiz(playerId, questId, topic) });
  } catch (error) {
    return errorResponse(error, 'quiz');
  }
}
