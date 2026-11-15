/**
 * Shared-secret checks for machine-to-machine routes. Fail closed: if the secret is not
 * configured the route refuses everyone (a missing env var must never open a route).
 *
 *   CRON_SECRET → `Authorization: Bearer <secret>`      (/api/cron/daily, /api/demo/reset)
 *   SYNC_TOKEN  → `X-Sync-Token: <token>` or Bearer     (/api/health, /api/watch)
 */
import { timingSafeEqual } from 'node:crypto';
import { fail } from '../../../lib/api-response';

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

const warned = new Set<string>();

function secretFromEnv(name: 'CRON_SECRET' | 'SYNC_TOKEN'): string | null {
  const value = process.env[name];
  if (value) return value;
  if (!warned.has(name)) console.error(`[auth] ${name} is not set — refusing all requests to routes that need it`);
  warned.add(name);
  return null;
}

/** Null when authorized, otherwise a ready 401. */
export function requireCronSecret(request: Request): Response | null {
  const secret = secretFromEnv('CRON_SECRET');
  return secret && safeEqual(bearer(request), secret) ? null : fail(401, 'Unauthorized');
}

/** Null when authorized, otherwise a ready 401. Accepts X-Sync-Token (Shortcuts, Watch) or a Bearer token. */
export function requireSyncToken(request: Request): Response | null {
  const token = secretFromEnv('SYNC_TOKEN');
  const given = request.headers.get('x-sync-token') ?? bearer(request);
  return token && safeEqual(given, token) ? null : fail(401, 'Unauthorized');
}
