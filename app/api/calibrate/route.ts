/**
 * POST /api/calibrate — body `{ upDist, downDist }` in cm, from the UI's one-rep
 * calibration step. Applies to the running push-up quest and all later ones.
 */
import { z } from 'zod';
import { calibratePushup } from '../../../engine/router';
import { MAX_VALID_CM, MIN_CALIBRATION_RANGE_CM } from '../../../engine/verifiers/pushup';
import { fail, ok } from '../../../lib/api-response';

const Distance = z.number().positive().max(MAX_VALID_CM);

const CalibrateSchema = z
  .object({ upDist: Distance, downDist: Distance })
  .refine((v) => v.upDist - v.downDist >= MIN_CALIBRATION_RANGE_CM, {
    path: ['upDist'],
    message: `upDist must be at least ${MIN_CALIBRATION_RANGE_CM} cm above downDist`,
  });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Body must be valid JSON');
  }

  const parsed = CalibrateSchema.safeParse(body);
  if (!parsed.success) return fail(400, z.prettifyError(parsed.error));

  const { upDist, downDist } = parsed.data;
  calibratePushup(upDist, downDist);
  return ok({ upDist, downDist });
}
