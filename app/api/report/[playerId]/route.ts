/** GET /api/report/:playerId[?fresh=1] — the Opus weekly Boss report (code-written fallback offline). */
import { connection } from 'next/server';
import { weeklyReport } from '../../../../engine/agents/boss';
import { fail, ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../../_lib/http';

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }): Promise<Response> {
  await connection();
  const id = PlayerIdSchema.safeParse((await params).playerId);
  if (!id.success) return fail(400, 'Invalid id');
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    return ok(await weeklyReport(id.data, { fresh }));
  } catch (error) {
    return errorResponse(error, 'report');
  }
}
