/** GET /api/quests/:playerId — the player and all their quests (active first, live progress). */
import { connection } from 'next/server';
import { getPlayer, listQuests } from '../../../../engine/quests';
import { fail, ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../../_lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> },
): Promise<Response> {
  await connection();
  const id = PlayerIdSchema.safeParse((await params).playerId);
  if (!id.success) return fail(400, 'Invalid player id');
  try {
    const player = await getPlayer(id.data);
    if (!player) return fail(404, `No player ${id.data}`);
    return ok({ player, quests: listQuests(id.data) });
  } catch (error) {
    return errorResponse(error, 'quests');
  }
}
