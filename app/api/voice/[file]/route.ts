/** GET /api/voice/:hash.mp3 — a cached Iris line (ElevenLabs or Polly; immutable: the name is a hash of provider + voice + text). */
import { readCachedVoice } from '../../../../lib/voice/tts';
import { fail } from '../../../../lib/api-response';

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const audio = await readCachedVoice((await params).file);
  if (!audio) return fail(404, 'No such voice line');
  return new Response(Buffer.from(audio), {
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
