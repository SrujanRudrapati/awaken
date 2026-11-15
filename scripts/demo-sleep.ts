/**
 * npm run demo:sleep [-- <playerId>] [--short] [--tonight] — posts a realistic Apple Watch night to
 * POST /api/health exactly like the iPhone Shortcut would (type "sleep", samples with
 * Shortcut-style stage strings). Last night, 23:35 → 06:55 local (7 h 13 min asleep): 5 sleep cycles, 2 awakenings.
 * --short: a 5 h night (00:55 → 06:00) to show the designer's lighter day.
 * --tonight: tonight instead of last night — vows made today are about tonight, so use this on stage.
 * Needs the app running (APP_URL, default http://localhost:3000) and SYNC_TOKEN.
 */
const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_PLAYER = 'demo-jin';
const MINUTE = 60_000;

type Stage = 'In Bed' | 'Awake' | 'Asleep Core' | 'Asleep Deep' | 'Asleep REM';

/** Minutes per stage, in order. */
const FULL_NIGHT: readonly (readonly [Stage, number])[] = [
  ['Asleep Core', 20], ['Asleep Deep', 45], ['Asleep Core', 15], ['Asleep REM', 12],
  ['Asleep Core', 25], ['Asleep Deep', 32], ['Asleep REM', 20], ['Awake', 4],
  ['Asleep Core', 38], ['Asleep Deep', 14], ['Asleep REM', 30],
  ['Asleep Core', 42], ['Asleep REM', 28], ['Awake', 3], ['Asleep Core', 31], ['Asleep REM', 16],
  ['Asleep Core', 45], ['Asleep REM', 20],
];
const SHORT_NIGHT: readonly (readonly [Stage, number])[] = [
  ['Asleep Core', 30], ['Asleep Deep', 35], ['Asleep REM', 15], ['Asleep Core', 40], ['Asleep Deep', 20],
  ['Asleep REM', 25], ['Awake', 5], ['Asleep Core', 60], ['Asleep REM', 35], ['Asleep Core', 40],
];

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local
  }
}

export function buildNight(short: boolean, tonight = false, now = new Date()) {
  const start = new Date(now);
  if (!tonight) start.setDate(start.getDate() - 1);
  start.setHours(short ? 24 : 23, short ? 55 : 35, 0, 0); // short: hour 24 rolls over to 00:55 today
  const plan = short ? SHORT_NIGHT : FULL_NIGHT;
  const samples: { start: string; end: string; stage: string }[] = [];
  let cursor = start.getTime();
  for (const [stage, minutes] of plan) {
    samples.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + minutes * MINUTE).toISOString(), stage });
    cursor += minutes * MINUTE;
  }
  samples.unshift({ start: new Date(start.getTime() - 15 * MINUTE).toISOString(), end: new Date(cursor + 5 * MINUTE).toISOString(), stage: 'In Bed' });
  return samples;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const short = args.includes('--short');
  const tonight = args.includes('--tonight');
  const playerId = args.find((a) => !a.startsWith('--')) ?? process.env.HEALTH_PLAYER_ID ?? DEFAULT_PLAYER;
  const token = process.env.SYNC_TOKEN;
  if (!token) {
    console.error('[demo:sleep] SYNC_TOKEN is not set in .env.local');
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || DEFAULT_APP_URL;
  const samples = buildNight(short, tonight);
  const res = await fetch(`${appUrl}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-token': token },
    body: JSON.stringify({ type: 'sleep', playerId, samples }),
  });
  const body = (await res.json()) as { success: boolean; data: unknown; error: string | null };
  if (!res.ok || !body.success) {
    console.error(`[demo:sleep] ${res.status}: ${body.error}`);
    process.exit(1);
  }
  console.log(`[demo:sleep] ${samples.length} samples for ${playerId} (${tonight ? 'tonight' : 'last night'}${short ? ', short' : ''}):`);
  console.log(JSON.stringify(body.data, null, 2));
}

main().catch((error: unknown) => {
  console.error('[demo:sleep] failed:', error instanceof Error ? error.message : error, '— is `npm run dev` running?');
  process.exit(1);
});
