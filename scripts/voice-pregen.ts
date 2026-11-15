/**
 * npm run voice:pregen — renders every canned Iris line into the voice cache (ElevenLabs with
 * audio tags, else Polly with tags stripped) so fallback lines never wait on the network.
 * Skips (exit 0) when neither ElevenLabs nor AWS is configured.
 */
import { CANNED_LINES } from '../engine/agents/voicePersona';
import { pollyVoice } from '../lib/aws/polly';
import { hasAwsCredentials } from '../lib/aws/config';
import { elevenLabsModel, elevenLabsVoice, isElevenLabsConfigured } from '../lib/voice/elevenlabs';
import { speak, voiceCacheDir } from '../lib/voice/tts';

const PREGEN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the real environment
  }
  if (!isElevenLabsConfigured() && !hasAwsCredentials()) {
    console.warn('[voice:pregen] neither ELEVENLABS_API_KEY+ELEVENLABS_VOICE_ID nor AWS set — skipping (browser speech will be used).');
    return;
  }
  const lines = [...new Set(Object.values(CANNED_LINES).flat())];
  const engine = isElevenLabsConfigured() ? `ElevenLabs ${elevenLabsModel()} voice ${elevenLabsVoice()}` : `Polly ${pollyVoice()}`;
  console.log(`[voice:pregen] ${lines.length} lines · ${engine} · cache ${voiceCacheDir()}`);
  let ok = 0;
  for (const line of lines) {
    const url = await speak(line, PREGEN_TIMEOUT_MS);
    if (url) ok += 1;
    console.log(`${url ? 'ok  ' : 'FAIL'} ${line}`);
  }
  console.log(`[voice:pregen] ${ok}/${lines.length} cached`);
}

main().catch((error: unknown) => {
  console.error('[voice:pregen] failed:', error instanceof Error ? error.message : error);
});
