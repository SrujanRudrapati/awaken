/**
 * POST /api/demo/reset — removes ONLY test/demo players (ids `demo-…` / `test-…`, see lib/demo.ts) with their
 * vows, sessions, wallets, baselines, Calibrations, nights and events, from memory and Tiger Data, and re-arms
 * DEMO_MODE's guaranteed rank-up for the next urgent vow. Requires `Authorization: Bearer <CRON_SECRET>`.
 * Called by `npm run demo:reset`.
 */
import { resetDemoState } from '../../../../engine/demoReset';
import { ok } from '../../../../lib/api-response';
import { deleteDemoPlayers } from '../../../../lib/db';
import { isDemoPlayerId } from '../../../../lib/demo';
import { requireCronSecret } from '../../_lib/auth';
import { errorResponse } from '../../_lib/http';

export async function POST(request: Request): Promise<Response> {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const { memoryPlayers } = resetDemoState(isDemoPlayerId);
    const tiger = await deleteDemoPlayers();
    return ok({ memoryPlayers, tiger });
  } catch (error) {
    return errorResponse(error, 'demo/reset');
  }
}
