/**
 * Iris speaks: ElevenLabs (tagged text) → Polly (tags stripped) → null, in which case the voice
 * event has no `audioUrl` and the browser speaks the text (lib/voicePlayback.ts).
 * MP3s are cached on disk by a hash of provider + voice + text and served by
 * GET /api/voice/<hash>.mp3; canned lines are pre-generated with `npm run voice:pregen`.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isPollyConfigured, pollyVoice, synthesizePolly } from '../aws/polly';
import { elevenLabsModel, elevenLabsVoice, isElevenLabsConfigured, synthesizeElevenLabs } from './elevenlabs';
import { stripTags } from './tags';

export const TTS_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_DIR = '/tmp/awaken-voice';
export const VOICE_URL_PREFIX = '/api/voice/';
/** What GET /api/voice accepts: exactly a cache file name, so no path tricks are possible. */
export const VOICE_FILE_PATTERN = /^[a-f0-9]{64}\.mp3$/;

export type VoiceProvider = 'elevenlabs' | 'polly';

interface Candidate {
  provider: VoiceProvider;
  name: string;
  synthesize: (timeoutMs: number) => Promise<Uint8Array | null>;
}

const globalForTts = globalThis as typeof globalThis & { __awakenTtsInflight?: Map<string, Promise<string | null>> };

export function voiceCacheDir(): string {
  return process.env.VOICE_CACHE_DIR || DEFAULT_CACHE_DIR;
}

/** Cache file name for one rendering (changing provider, voice or model changes the name). */
export function voiceFileName(provider: VoiceProvider, voice: string, text: string): string {
  return `${createHash('sha256').update(`${provider}|${voice}|${text}`).digest('hex')}.mp3`;
}

/** Providers in preference order, with the cache name each would use for this line. */
function candidates(taggedText: string): Candidate[] {
  const plain = stripTags(taggedText);
  const list: Candidate[] = [];
  const eleven = elevenLabsVoice();
  if (eleven) {
    list.push({
      provider: 'elevenlabs',
      name: voiceFileName('elevenlabs', `${eleven}|${elevenLabsModel()}`, taggedText),
      synthesize: (ms) => (isElevenLabsConfigured() ? synthesizeElevenLabs(taggedText, ms) : Promise.resolve(null)),
    });
  }
  list.push({
    provider: 'polly',
    name: voiceFileName('polly', `${pollyVoice()}|neural`, plain),
    synthesize: (ms) => (isPollyConfigured() ? synthesizePolly(plain, ms) : Promise.resolve(null)),
  });
  return list;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function render(taggedText: string, timeoutMs: number): Promise<string | null> {
  const list = candidates(taggedText);
  for (const c of list) {
    if (await exists(path.join(voiceCacheDir(), c.name))) return `${VOICE_URL_PREFIX}${c.name}`;
  }
  const deadline = Date.now() + timeoutMs;
  for (const c of list) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const audio = await c.synthesize(left);
    if (!audio) continue;
    const file = path.join(voiceCacheDir(), c.name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, audio);
    return `${VOICE_URL_PREFIX}${c.name}`;
  }
  return null;
}

/** `/api/voice/<hash>.mp3` for a (tagged) Iris line, or null → the browser speaks it. */
export function speak(taggedText: string, timeoutMs = TTS_TIMEOUT_MS): Promise<string | null> {
  const key = candidates(taggedText).map((c) => c.name).join('|');
  globalForTts.__awakenTtsInflight ??= new Map();
  const inflight = globalForTts.__awakenTtsInflight;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = render(taggedText, timeoutMs)
    .catch((error: unknown) => {
      console.error('[voice] tts failed:', error instanceof Error ? error.message : error);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Reads a cached MP3 by file name; null if the name is invalid or not cached. */
export async function readCachedVoice(fileName: string): Promise<Uint8Array | null> {
  if (!VOICE_FILE_PATTERN.test(fileName)) return null;
  return readFile(path.join(voiceCacheDir(), fileName)).catch(() => null);
}

/** Test hook. */
export function resetTts(): void {
  globalForTts.__awakenTtsInflight = undefined;
}
