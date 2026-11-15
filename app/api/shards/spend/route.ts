/**
 * POST /api/shards/spend — Shards are earn-only; spend on:
 *   { playerId, item: "shield" } (200) · { playerId, item: "bonus" } (150)
 *   { playerId, item: "halve", questId } (300, active Reckoning vow, once / 7 days)
 *   { playerId, item: "cosmetic", cosmeticId } (100–500, see GET /api/shards/:playerId)
 */
import { z } from 'zod';
import { spend } from '../../../../engine/shards';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.intersection(
  z.object({ playerId: PlayerIdSchema }),
  z.discriminatedUnion('item', [
    z.object({ item: z.literal('shield') }),
    z.object({ item: z.literal('bonus') }),
    z.object({ item: z.literal('halve'), questId: z.string().min(1).max(64) }),
    z.object({ item: z.literal('cosmetic'), cosmeticId: z.string().min(1).max(40) }),
  ]),
);

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const { playerId, ...input } = body.data;
    return ok(await spend(playerId, input));
  } catch (error) {
    return errorResponse(error, 'shards/spend');
  }
}
