/**
 * Maritime midnight agent: a tiny HTTP server Maritime hosts in its own micro-VM.
 * A Maritime cron trigger wakes it and delivers a prompt to POST /chat; it then calls Awaken's
 * POST /api/cron/daily (Bearer CRON_SECRET) — the Penalty Zone sweep + today's vow drop — and logs
 * each run to /data/runs.jsonl. "status" reports the last run without dropping.
 *
 * Zero dependencies; runs as-is on Node ≥ 23.6 (type stripping): `node server.ts`.
 * Env: AWAKEN_URL (public Awaken URL), CRON_SECRET, PORT (Maritime sets it), DATA_DIR (default /data).
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** Maritime gives /chat 30 s; reply before that even if Awaken is still dropping. */
const DEFAULT_REPLY_WITHIN_MS = 25_000;
/** Give up on Awaken after this long (Gemini designs each person's vows). */
const DROP_TIMEOUT_MS = 120_000;
const RUN_LOG = 'runs.jsonl';

export interface AgentConfig {
  awakenUrl: string;
  cronSecret: string;
  dataDir: string;
  replyWithinMs: number;
}

export type RunResult =
  | { ok: true; at: string; players: number; quests: number; ms: number }
  | { ok: false; at: string; status?: number; error: string; ms: number };

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    awakenUrl: (env.AWAKEN_URL ?? '').replace(/\/+$/, ''),
    cronSecret: env.CRON_SECRET ?? '',
    dataDir: env.DATA_DIR ?? '/data',
    replyWithinMs: DEFAULT_REPLY_WITHIN_MS,
  };
}

function logRun(config: AgentConfig, run: RunResult): void {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    appendFileSync(join(config.dataDir, RUN_LOG), `${JSON.stringify(run)}\n`);
  } catch (error: unknown) {
    console.error('[maritime] could not write run log:', error instanceof Error ? error.message : error);
  }
  console.log('[maritime] run', JSON.stringify(run));
}

export function lastRun(config: AgentConfig): RunResult | null {
  try {
    const lines = readFileSync(join(config.dataDir, RUN_LOG), 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]) as RunResult;
  } catch {
    return null;
  }
}

interface DropBody {
  success?: boolean;
  data?: { players?: number; quests?: Record<string, number> } | null;
  error?: string | null;
}

/** One midnight drop: Penalty Zone sweep + today's vows for everyone. Never throws; always logs. */
export async function runDailyDrop(config: AgentConfig, fetchFn: typeof fetch = fetch): Promise<RunResult> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const finish = (run: RunResult): RunResult => {
    logRun(config, run);
    return run;
  };
  if (!config.awakenUrl || !config.cronSecret) {
    return finish({ ok: false, at, error: 'Set AWAKEN_URL and CRON_SECRET (maritime env set)', ms: 0 });
  }
  try {
    const res = await fetchFn(`${config.awakenUrl}/api/cron/daily`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.cronSecret}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(DROP_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as DropBody;
    const ms = Date.now() - started;
    if (!res.ok || !body.success) {
      return finish({ ok: false, at, status: res.status, error: body.error ?? `HTTP ${res.status}`, ms });
    }
    const quests = Object.values(body.data?.quests ?? {}).reduce((sum, n) => sum + n, 0);
    return finish({ ok: true, at, players: body.data?.players ?? 0, quests, ms });
  } catch (error: unknown) {
    return finish({ ok: false, at, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
  }
}

function summary(run: RunResult): string {
  return run.ok
    ? `Dropped ${run.quests} vows for ${run.players} people (Penalty Zone swept) in ${run.ms} ms.`
    : `Midnight drop failed${run.status ? ` (HTTP ${run.status})` : ''}: ${run.error}`;
}

async function chat(message: string, config: AgentConfig, fetchFn: typeof fetch): Promise<string> {
  if (/\bstatus\b/i.test(message)) {
    const run = lastRun(config);
    return run ? `Last run ${run.at}: ${run.ok ? 'ok' : 'failed'} — ${summary(run)}` : 'No runs yet.';
  }
  const running = runDailyDrop(config, fetchFn);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), config.replyWithinMs);
  });
  const run = await Promise.race([running, slow]).finally(() => clearTimeout(timer));
  return run ? summary(run) : 'Midnight drop started; Awaken is still running it (see runs.jsonl / status).';
}

/** Routes one request (Fetch API types, so it's testable without a socket). */
export async function handle(request: Request, config: AgentConfig, fetchFn: typeof fetch = fetch): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET' && (pathname === '/health' || pathname === '/')) {
    return Response.json({ ok: true, agent: 'awaken-midnight', lastRun: lastRun(config) });
  }
  if (request.method === 'POST' && pathname === '/chat') {
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === 'string' ? body.message : '';
    return Response.json({ response: await chat(message, config, fetchFn) });
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
}

function serve(): void {
  const config = configFromEnv();
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(`http://agent${req.url ?? '/'}`, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      });
      handle(request, config)
        .then(async (response) => {
          res.writeHead(response.status, { 'content-type': 'application/json' });
          res.end(await response.text());
        })
        .catch((error: unknown) => {
          console.error('[maritime] request failed:', error);
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal error' }));
        });
    });
  }).listen(port, '0.0.0.0', () => console.log(`[maritime] awaken-midnight listening on 0.0.0.0:${port} → ${config.awakenUrl || '(AWAKEN_URL unset)'}`));
}

if (process.argv[1]?.endsWith('server.ts')) serve();
