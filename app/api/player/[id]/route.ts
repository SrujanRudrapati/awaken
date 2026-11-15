/** GET /api/player/:id — the player (engine memory, else Tiger) plus 7 days of XP per stat. */
import { connection } from 'next/server';
import { z } from 'zod';
import { fail, ok } from '../../../../lib/api-response';
import { getPlayer } from '../../../../engine/quests';
import { statHistory } from '../../../../lib/db';

const IdSchema = z.string().min(1).max(64);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const id = IdSchema.safeParse((await params).id);
  if (!id.success) return fail(400, 'Invalid id');
  try {
    const [player, history] = await Promise.all([getPlayer(id.data), statHistory(id.data)]);
    if (!player) return fail(404, `No one found with id ${id.data}`);
    return ok({ player, history });
  } catch (error) {
    console.error('[player] query failed', error);
    return fail(503, 'Profile data unavailable');
  }
}
