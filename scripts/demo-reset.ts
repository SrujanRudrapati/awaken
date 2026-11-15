/**
 * npm run demo:reset — deletes ONLY test/demo players (ids `demo-…` / `test-…`) and their events.
 *
 * 1. Asks the running app (APP_URL, default http://localhost:3000) to purge them from memory
 *    AND Tiger Data via POST /api/demo/reset (Bearer CRON_SECRET).
 * 2. If the app isn't running, deletes from Tiger Data directly (memory is empty anyway).
 * Real players are never touched: see lib/demo.ts for the exact id pattern.
 */
import { deleteDemoPlayers } from '../lib/db';

const DEFAULT_APP_URL = 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 5_000;

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the real environment
  }
}

async function resetViaApp(appUrl: string, secret: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${appUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json()) as { success: boolean; data: unknown; error: string | null };
    if (!res.ok || !body.success) throw new Error(`app refused reset (${res.status}): ${body.error}`);
    return body.data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('app refused')) throw error;
    return null; // app not reachable
  }
}

async function main(): Promise<void> {
  loadEnv();
  const appUrl = process.env.APP_URL || DEFAULT_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set in .env.local');

  const viaApp = await resetViaApp(appUrl, secret);
  if (viaApp) {
    console.info('[demo:reset] app + Tiger:', JSON.stringify(viaApp));
    return;
  }
  console.info(`[demo:reset] app not reachable at ${appUrl} — deleting from Tiger Data only`);
  const tiger = await deleteDemoPlayers();
  console.info('[demo:reset] Tiger:', tiger ? JSON.stringify(tiger) : 'TIGER_DATABASE_URL not set, nothing to do');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[demo:reset] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
