/**
 * POST /api/calibration/submit — one step of a stage:
 *   { playerId, stage: "body"|"vitality", action: "begin" }   → 60 s measurement window opens (sensors count)
 *   { playerId, stage: "body"|"vitality", action: "finish" }  → read the result (the window also closes itself)
 *   { playerId, stage: "mind", action: "begin" }              → first question
 *   { playerId, stage: "mind", action: "answer", questionId, answerIndex } → { correct, next | done, score? }
 *   { playerId, stage: "focus", action: "begin" }             → go/no-go schedule
 *   { playerId, stage: "focus", action: "submit", responses: [{ i, rtMs | null }] } → score
 * Every response includes the session; the last stage completes Calibration (rank, stats, baselines).
 */
import { z } from 'zod';
import { submitCalibration } from '../../../../engine/calibration/session';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const MAX_RESPONSES = 100;

const BodySchema = z.intersection(
  z.object({ playerId: PlayerIdSchema }),
  z.union([
    z.object({ stage: z.enum(['body', 'vitality']), action: z.enum(['begin', 'finish']) }),
    z.object({ stage: z.literal('mind'), action: z.literal('begin') }),
    z.object({ stage: z.literal('mind'), action: z.literal('answer'), questionId: z.string().min(1).max(16), answerIndex: z.number().int().min(0).max(3) }),
    z.object({ stage: z.literal('focus'), action: z.literal('begin') }),
    z.object({
      stage: z.literal('focus'),
      action: z.literal('submit'),
      responses: z.array(z.object({ i: z.number().int().min(0).max(MAX_RESPONSES), rtMs: z.number().min(0).max(5_000).nullable() })).max(MAX_RESPONSES),
    }),
  ]),
);

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const { playerId, ...input } = body.data;
    return ok(await submitCalibration(playerId, input));
  } catch (error) {
    return errorResponse(error, 'calibration/submit');
  }
}
