/** POST /api/player — `{ name, id? }` → creates the player (or returns the existing one with that id). */
import { z } from 'zod';
import { createPlayer } from '../../../engine/quests';
import { ok } from '../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../_lib/http';

const BodySchema = z.object({ name: z.string().trim().min(1).max(40), id: PlayerIdSchema.optional() });

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    return ok({ player: await createPlayer(body.data) });
  } catch (error) {
    return errorResponse(error, 'player');
  }
}
