/**
 * The System's spoken voice: Amazon Polly neural TTS (voice from POLLY_VOICE), MP3s cached on
 * disk by a hash of voice + text and served by GET /api/voice/<hash>.mp3. Canned lines are
 * pre-generated (npm run voice:pregen) so they never wait on Polly.
 *
 * No AWS, Polly slow or failing → null: the voice event goes out without `audioUrl` and the
 * browser speaks it with speechSynthesis (lib/voicePlayback.ts).
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from '@aws-sdk/client-polly';
import { awsRegion, hasAwsCredentials, logAwsFailure } from './config';

export const DEFAULT_POLLY_VOICE = 'Matthew';
export const POLLY_TIMEOUT_MS = 2_500;
const DEFAULT_CACHE_DIR = '/tmp/awaken-voice';
export const VOICE_URL_PREFIX = '/api/voice/';
/** What GET /api/voice accepts: exactly a cache file name, so no path tricks are possible. */
export const VOICE_FILE_PATTERN = /^[a-f0-9]{64}\.mp3$/;

const globalForPolly = globalThis as typeof globalThis & {
  __awakenPolly?: PollyClient;
  __awakenPollyInflight?: Map<string, Promise<string | null>>;
};

export function pollyVoice(): string {
  return process.env.POLLY_VOICE || DEFAULT_POLLY_VOICE;
}

export function voiceCacheDir(): string {
  return process.env.VOICE_CACHE_DIR || DEFAULT_CACHE_DIR;
}

/** Cache file name for a line in the current voice (changing POLLY_VOICE changes every name). */
export function voiceFileName(text: string, voice = pollyVoice()): string {
  return `${createHash('sha256').update(`${voice}|neural|${text}`).digest('hex')}.mp3`;
}

function polly(): PollyClient {
  globalForPolly.__awakenPolly ??= new PollyClient({ region: awsRegion() ?? undefined, maxAttempts: 1 });
  return globalForPolly.__awakenPolly;
}

function inflight(): Map<string, Promise<string | null>> {
  globalForPolly.__awakenPollyInflight ??= new Map();
  return globalForPolly.__awakenPollyInflight;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function synthesizeToCache(text: string, file: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await polly().send(
      new SynthesizeSpeechCommand({ Engine: 'neural', OutputFormat: 'mp3', Text: text, VoiceId: pollyVoice() as VoiceId }),
      { abortSignal: AbortSignal.timeout(timeoutMs) },
    );
    const audio = await response.AudioStream?.transformToByteArray();
    if (!audio?.byteLength) return false;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, audio);
    return true;
  } catch (error) {
    logAwsFailure('polly', error);
    return false;
  }
}

/** `/api/voice/<hash>.mp3` for `text` (cache hit, or freshly synthesized), else null. */
export async function speak(text: string, timeoutMs = POLLY_TIMEOUT_MS): Promise<string | null> {
  const name = voiceFileName(text);
  const file = path.join(voiceCacheDir(), name);
  const url = `${VOICE_URL_PREFIX}${name}`;
  if (await exists(file)) return url;
  if (!hasAwsCredentials()) return null;

  const pending = inflight().get(name);
  if (pending) return pending;
  const job = synthesizeToCache(text, file, timeoutMs)
    .then((ok) => (ok ? url : null))
    .finally(() => inflight().delete(name));
  inflight().set(name, job);
  return job;
}

/** Reads a cached MP3 by file name; null if the name is invalid or not cached. */
export async function readCachedVoice(fileName: string): Promise<Uint8Array | null> {
  if (!VOICE_FILE_PATTERN.test(fileName)) return null;
  return readFile(path.join(voiceCacheDir(), fileName)).catch(() => null);
}

/** Test hook. */
export function resetPolly(): void {
  globalForPolly.__awakenPolly = undefined;
  globalForPolly.__awakenPollyInflight = undefined;
}
