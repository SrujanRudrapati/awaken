/**
 * POST /api/player/:id/goals — `{ goal }` ("get stronger", "pass calc") → saved to the player's
 * Supermemory namespace; the designer and voice use it. `saved: false` when memory is offline.
 */
import { z } from 'zod';
import { getPlayer } from '../../../../../engine/quests';
import { fail, ok } from '../../../../../lib/api-response';
import { remember } from '../../../../../lib/memory';
import { PlayerIdSchema, errorResponse, parseJson } from '../../../_lib/http';

const BodySchema = z.object({ goal: z.string().trim().min(3).max(200) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = PlayerIdSchema.safeParse((await params).id);
  if (!id.success) return fail(400, 'Invalid id');
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    if (!(await getPlayer(id.data))) return fail(404, `No one found with id ${id.data}`);
    const saved = await remember(id.data, `Goal: ${body.data.goal}`, { kind: 'goal', instant: true });
    return ok({ saved });
  } catch (error) {
    return errorResponse(error, 'player/goals');
  }
}
