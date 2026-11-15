/** GET /api/shards/:playerId — Shards wallet (balance, earned, shields, cosmetics) + prices + cosmetic catalog. */
import { connection } from 'next/server';
import { walletFor } from '../../../../engine/shards';
import { fail, ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../../_lib/http';

export async function GET(_request: Request, { params }: { params: Promise<{ playerId: string }> }): Promise<Response> {
  await connection();
  const id = PlayerIdSchema.safeParse((await params).playerId);
  if (!id.success) return fail(400, 'Invalid id');
  try {
    return ok(await walletFor(id.data));
  } catch (error) {
    return errorResponse(error, 'shards');
  }
}
