/**
 * POST /api/calibration/start — `{ playerId, age?, bodyVariant?: "pushup"|"wallpushup"|"chairsquat", includeHealth? }`
 * → the Calibration session (4 stages). 409 if the last Calibration was < 30 days ago (not in DEMO_MODE).
 */
import { z } from 'zod';
import { startCalibration } from '../../../../engine/calibration/session';
import { ok } from '../../../../lib/api-response';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const BodySchema = z.object({
  playerId: PlayerIdSchema,
  age: z.number().int().min(13).max(110).optional(),
  bodyVariant: z.enum(['pushup', 'wallpushup', 'chairsquat']).optional(),
  includeHealth: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  try {
    const { playerId, ...options } = body.data;
    return ok({ session: await startCalibration(playerId, options) });
  } catch (error) {
    return errorResponse(error, 'calibration/start');
  }
}
