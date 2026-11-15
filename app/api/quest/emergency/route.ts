/** POST /api/quest/emergency — `{ playerId, type? }` → 10 reps in 30 s or Penalty Zone. */
import { z } from 'zod';
import { emergencyQuest } from '../../../../engine/quests';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.object({
  playerId: PlayerIdSchema,
  type: z.enum(['pushup', 'squat', 'jumpingjack', 'situp']).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    return ok({ quest: await emergencyQuest(body.data.playerId, body.data.type) });
  } catch (error) {
    return errorResponse(error, 'quest/emergency');
  }
}
