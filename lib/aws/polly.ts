/**
 * Amazon Polly neural TTS (Iris's second voice; POLLY_VOICE, default Matthew). Plain text only —
 * callers strip audio tags first. Returns MP3 bytes or null. Caching lives in lib/voice/tts.ts.
 */
import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from '@aws-sdk/client-polly';
import { awsRegion, hasAwsCredentials, logAwsFailure } from './config';

export const DEFAULT_POLLY_VOICE = 'Matthew';

const globalForPolly = globalThis as typeof globalThis & { __awakenPolly?: PollyClient };

export function pollyVoice(): string {
  return process.env.POLLY_VOICE || DEFAULT_POLLY_VOICE;
}

export function isPollyConfigured(): boolean {
  return hasAwsCredentials();
}

function polly(): PollyClient {
  globalForPolly.__awakenPolly ??= new PollyClient({ region: awsRegion() ?? undefined, maxAttempts: 1 });
  return globalForPolly.__awakenPolly;
}

export async function synthesizePolly(plainText: string, timeoutMs: number): Promise<Uint8Array | null> {
  if (!isPollyConfigured()) return null;
  try {
    const response = await polly().send(
      new SynthesizeSpeechCommand({ Engine: 'neural', OutputFormat: 'mp3', Text: plainText, VoiceId: pollyVoice() as VoiceId }),
      { abortSignal: AbortSignal.timeout(timeoutMs) },
    );
    const audio = await response.AudioStream?.transformToByteArray();
    return audio?.byteLength ? audio : null;
  } catch (error) {
    logAwsFailure('polly', error);
    return null;
  }
}

/** Test hook. */
export function resetPolly(): void {
  globalForPolly.__awakenPolly = undefined;
}
