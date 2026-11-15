/**
 * npm run voice:pregen — synthesizes every canned System line with Polly into the voice cache
 * so fallback lines never wait on the network. Skips (exit 0) without AWS credentials.
 */
import { CANNED_LINES } from '../engine/agents/voicePersona';
import { pollyVoice, speak, voiceCacheDir } from '../lib/aws/polly';
import { hasAwsCredentials } from '../lib/aws/config';

const PREGEN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the real environment
  }
  if (!hasAwsCredentials()) {
    console.warn('[voice:pregen] AWS_REGION + credentials not set — skipping (browser speech will be used).');
    return;
  }
  const lines = [...new Set(Object.values(CANNED_LINES).flat())];
  console.log(`[voice:pregen] ${lines.length} lines · voice ${pollyVoice()} · cache ${voiceCacheDir()}`);
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
