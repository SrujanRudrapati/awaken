/** GET /api/constellation/:playerId — their Constellation (~30 people of similar Power), ordered by this week's Proof. */
import { connection } from 'next/server';
import { constellationOf } from '../../../../engine/constellations';
import { fail, ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../../_lib/http';

export async function GET(_request: Request, { params }: { params: Promise<{ playerId: string }> }): Promise<Response> {
  await connection();
  const id = PlayerIdSchema.safeParse((await params).playerId);
  if (!id.success) return fail(400, 'Invalid id');
  try {
    return ok(await constellationOf(id.data));
  } catch (error) {
    return errorResponse(error, 'constellation');
  }
}
