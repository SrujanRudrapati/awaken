/**
 * POST /api/player — `{ name, id? }` → creates the player (or returns the existing one with that id).
 * A newly created player gets the System's awakening line.
 */
import { z } from 'zod';
import { announceAwakening } from '../../../engine/agents/voice';
import { createPlayer, getPlayer } from '../../../engine/quests';
import { ok } from '../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../_lib/http';

const BodySchema = z.object({ name: z.string().trim().min(1).max(40), id: PlayerIdSchema.optional() });

async function exists(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  return getPlayer(id).then(
    (p) => p !== null,
    () => false,
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const existed = await exists(body.data.id);
    const player = await createPlayer(body.data);
    if (!existed) announceAwakening(player.id, player.name);
    return ok({ player, created: !existed });
  } catch (error) {
    return errorResponse(error, 'player');
  }
}
