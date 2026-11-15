/**
 * POST /api/photo — multipart form: `playerId`, `questId`, `photo` (image file, ≤ 8 MB).
 * Stores the photo, Gemini judges it, code decides (confidence ≥ 0.7). Passing completes
 * the quest; failing lets the player retry.
 */
import { z } from 'zod';
import { submitPhotoProof } from '../../../engine/agents/photoProof';
import { fail, ok } from '../../../lib/api-response';
import { PlayerIdSchema, errorResponse } from '../_lib/http';

const FieldsSchema = z.object({ playerId: PlayerIdSchema, questId: z.string().min(1).max(64) });

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Body must be multipart/form-data');
  }
  const fields = FieldsSchema.safeParse({ playerId: form.get('playerId'), questId: form.get('questId') });
  if (!fields.success) return fail(400, z.prettifyError(fields.error));
  const photo = form.get('photo');
  if (!(photo instanceof File)) return fail(400, 'Missing `photo` file');

  try {
    const result = await submitPhotoProof({
      ...fields.data,
      bytes: new Uint8Array(await photo.arrayBuffer()),
      mimeType: photo.type,
    });
    return ok({
      passed: result.passed,
      confidence: result.confidence,
      reason: result.reason,
      storage: result.storage,
      photoUrl: result.photoUrl,
      xpGained: result.completion?.quest.xp ?? 0,
      leveledUp: result.completion?.leveledUp ?? false,
    });
  } catch (error) {
    return errorResponse(error, 'photo');
  }
}
