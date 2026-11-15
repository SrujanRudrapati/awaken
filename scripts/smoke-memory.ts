/**
 * npm run smoke:memory — live Supermemory round trip on the `player_demo-smoke` namespace:
 * remembers a goal (instant processing), then recalls it a few times while it's indexed.
 * Never fails the build: no SUPERMEMORY_API_KEY → it says so and exits 0.
 */
import { recall, remember, resetMemory } from '../lib/memory';

const PLAYER = 'demo-smoke';
const ATTEMPTS = 6;
const WAIT_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the real environment
  }
  if (!process.env.SUPERMEMORY_API_KEY) {
    console.warn('[smoke:memory] SUPERMEMORY_API_KEY not set — skipping.');
    return;
  }
  const saved = await remember(PLAYER, "Player's goal: run a 5k before the semester ends", { kind: 'goal', instant: true });
  console.log(`[smoke:memory] remember → ${saved}`);
  for (let i = 1; i <= ATTEMPTS; i += 1) {
    resetMemory(); // bypass the recall cache between attempts
    const found = await recall(PLAYER, "player's goals", 5_000);
    console.log(`[smoke:memory] recall #${i} → ${found ?? '(nothing yet)'}`);
    if (found) return;
    await sleep(WAIT_MS);
  }
}

main().catch((error: unknown) => {
  console.error('[smoke:memory] unexpected error (not failing):', error instanceof Error ? error.message : error);
});
