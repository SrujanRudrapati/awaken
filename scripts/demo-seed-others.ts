/**
 * npm run demo:seed-others [-- <playerId>] — asks the running app to add 9 mixed profiles
 * (reader, runner, student, retiree, …) just above <playerId> (default HEALTH_PLAYER_ID or
 * demo-jin) on this week's leaderboard. Needs `npm run dev` and CRON_SECRET. Undo: npm run demo:reset.
 */
const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_PLAYER = 'demo-jin';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local
  }
  const playerId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.HEALTH_PLAYER_ID ?? DEFAULT_PLAYER;
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[demo:seed-others] CRON_SECRET is not set in .env.local');
    process.exit(1);
  }
  const res = await fetch(`${process.env.APP_URL || DEFAULT_APP_URL}/api/demo/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ playerId }),
  });
  const body = (await res.json()) as { success: boolean; data: { base: number; seeded: { name: string; label: string; weeklyProof: number }[] }; error: string | null };
  if (!res.ok || !body.success) {
    console.error(`[demo:seed-others] ${res.status}: ${body.error}`);
    process.exit(1);
  }
  console.log(`[demo:seed-others] ${playerId} has ${body.data.base} Proof this week. Seeded just above:`);
  console.table(body.data.seeded);
}

main().catch((error: unknown) => {
  console.error('[demo:seed-others] failed:', error instanceof Error ? error.message : error, '— is `npm run dev` running?');
  process.exit(1);
});
