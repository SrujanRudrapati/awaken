/**
 * ElevenLabs text-to-speech (Iris's primary voice). Model `eleven_v3` by default — verified
 * 2026-11-14 at elevenlabs.io/docs/models; v3 reads inline audio tags like [whispers].
 * POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128, header `xi-api-key`.
 * Returns MP3 bytes, or null on any failure (the caller falls back to Polly / browser speech).
 */
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_v3';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_128';

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

export function elevenLabsModel(): string {
  return process.env.ELEVENLABS_MODEL || DEFAULT_ELEVENLABS_MODEL;
}

export function elevenLabsVoice(): string | null {
  return process.env.ELEVENLABS_VOICE_ID || null;
}

export async function synthesizeElevenLabs(taggedText: string, timeoutMs: number): Promise<Uint8Array | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = elevenLabsVoice();
  if (!key || !voice) return null;
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: taggedText, model_id: elevenLabsModel() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.error(`[voice] elevenlabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return null;
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    return audio.byteLength > 0 ? audio : null;
  } catch (error) {
    console.error('[voice] elevenlabs failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
