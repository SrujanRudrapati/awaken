/**
 * npm run smoke:designer — calls the REAL Gemini designer once for a demo player and prints
 * the quests it chose. Never fails: with no GEMINI_API_KEY (or Gemini down) it says so and
 * prints the fallback templates. Exit code is always 0 so it can't break a build.
 */
import { createGeminiDesigner } from '../engine/agents/designer';
import { DAILY_TEMPLATES } from '../engine/progression';
import type { Player } from '../lib/schemas';

const DEMO_PLAYER: Player = {
  id: 'demo-smoke',
  name: 'Smoke Test',
  rank: 'E',
  level: 3,
  xp: 120,
  penalty: false,
  stats: { STR: 6, INT: 1, FOCUS: 0, VIT: 4, DISCIPLINE: 1, CHA: 0 },
};

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the real environment
  }
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[smoke:designer] GEMINI_API_KEY not set — skipping the live call (fallback templates would be used).');
    return;
  }
  console.log(`[smoke:designer] model ${process.env.GEMINI_MODEL || '(default)'} · player stats`, DEMO_PLAYER.stats);
  const started = Date.now();
  const quests = await createGeminiDesigner()(DEMO_PLAYER);
  const source = quests === DAILY_TEMPLATES ? 'FALLBACK templates (Gemini failed or returned too few valid quests)' : 'Gemini';
  console.log(`[smoke:designer] ${quests.length} quests from ${source} in ${Date.now() - started} ms:`);
  console.table(quests);
}

main().catch((error: unknown) => {
  console.error('[smoke:designer] unexpected error (not failing):', error instanceof Error ? error.message : error);
});
