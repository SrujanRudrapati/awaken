/**
 * GET /api/sleep?playerId=<id>&days=7 — nights (newest first) from Apple Watch samples:
 * bedtime, wake, asleep/deep/REM/core minutes, awakenings. playerId falls back to HEALTH_PLAYER_ID.
 */
import { connection } from 'next/server';
import { z } from 'zod';
import { recentNights } from '../../../engine/sleepSync';
import { fail, ok } from '../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../_lib/http';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const DaysSchema = z.coerce.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS);

export async function GET(request: Request): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const id = PlayerIdSchema.safeParse(params.get('playerId') ?? process.env.HEALTH_PLAYER_ID);
  if (!id.success) return fail(400, 'Missing your id — add it to the query or set HEALTH_PLAYER_ID');
  const days = DaysSchema.safeParse(params.get('days') ?? undefined);
  if (!days.success) return fail(400, `days must be 1–${MAX_DAYS}`);
  try {
    const nights = await recentNights(id.data, days.data);
    return ok({ playerId: id.data, days: days.data, nights });
  } catch (error) {
    return errorResponse(error, 'sleep');
  }
}
