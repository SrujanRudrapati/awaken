/**
 * Shared-secret checks for machine-to-machine routes. Fail closed: if the secret is not
 * configured the route refuses everyone (a missing env var must never open a route).
 *
 *   CRON_SECRET → `Authorization: Bearer <secret>`      (/api/cron/daily, /api/demo/reset)
 *   SYNC_TOKEN  → `X-Sync-Token: <token>` or Bearer     (/api/health, /api/watch, Home Base /api/readings)
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

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1']);
/** Headers a tunnel or proxy adds for a remote client (cloudflared sets cf-connecting-ip). */
const REMOTE_CLIENT_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'true-client-ip'];

/**
 * True for a request made on this machine (e.g. the bridge or simulator → http://localhost:3000): loopback Host,
 * no tunnel client header, and only loopback addresses in x-forwarded-for. Tunnel traffic also reaches the server
 * from localhost, but carries the public Host and cf-connecting-ip, so it is never treated as local.
 */
export function isLocalRequest(request: Request): boolean {
  if (!LOOPBACK.has(new URL(request.url).hostname)) return false;
  if (REMOTE_CLIENT_HEADERS.some((h) => request.headers.has(h))) return false;
  const forwarded = request.headers.get('x-forwarded-for');
  return !forwarded || forwarded.split(',').every((ip) => LOOPBACK.has(ip.trim()));
}

/** True when the request carries the right SYNC_TOKEN (fail closed when unset). */
export function hasSyncToken(request: Request): boolean {
  return requireSyncToken(request) === null;
}

/** Null when authorized, otherwise a ready 401. Accepts X-Sync-Token (Shortcuts, Watch) or a Bearer token. */
export function requireSyncToken(request: Request): Response | null {
  const token = secretFromEnv('SYNC_TOKEN');
  const given = request.headers.get('x-sync-token') ?? bearer(request);
  return token && safeEqual(given, token) ? null : fail(401, 'Unauthorized');
}
