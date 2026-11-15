/** POST /api/quiz/answer — `{ playerId, questId, answers: [i, i, i] }` → graded in code; ≥2/3 completes the quest. */
import { z } from 'zod';
import { answerQuiz } from '../../../../engine/agents/quiz';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.object({
  playerId: PlayerIdSchema,
  questId: z.string().min(1).max(64),
  answers: z.array(z.number().int().min(0).max(3)).min(1).max(10),
});

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const { playerId, questId, answers } = body.data;
    const result = await answerQuiz(playerId, questId, answers);
    return ok({
      correct: result.correct,
      passed: result.passed,
      answers: result.answers,
      xpGained: result.completion?.quest.xp ?? 0,
      leveledUp: result.completion?.leveledUp ?? false,
    });
  } catch (error) {
    return errorResponse(error, 'quiz/answer');
  }
}
