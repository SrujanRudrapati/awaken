/**
 * npm run db:migrate — applies idempotent, additive schema changes to Tiger Data
 * (currently: nullable `events.detail jsonb` for photo verdict reasons). Safe to re-run.
 */
import { migrate } from '../lib/db';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

migrate()
  .then((applied) => {
    if (applied === null) console.warn('[db:migrate] TIGER_DATABASE_URL not set — nothing to do.');
    else for (const sql of applied) console.log(`[db:migrate] ok: ${sql}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('[db:migrate] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
