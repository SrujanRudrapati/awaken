/**
 * Tiger Data (Postgres + Timescale) access. Tables (already created):
 *   players(id pk, name, rank, level, xp, stats jsonb, penalty, created_at)
 *   events(ts, player_id, stat, kind, value, verified, source)   -- hypertable
 *   daily_xp(day, player_id, stat, xp)   -- continuous aggregate over events where kind = 'xp'
 *
 * Without TIGER_DATABASE_URL every call is a harmless no-op (reads return null / []),
 * so the demo runs offline. logEvent is fire-and-forget and never throws.
 */
import { Pool, type QueryResultRow } from 'pg';
import { DEMO_PLAYER_ID_PATTERN } from './demo';
import { PlayerSchema, StatSchema, type Player, type Stat } from './schemas';

const CONNECT_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 5_000;
const POOL_SIZE = 5;
export const LEADERBOARD_SIZE = 10;
export const HISTORY_DAYS = 7;

/** Where an event came from: a reading source, or the subsystem that produced it. */
export type EventSource = 'homebase' | 'phone' | 'watch' | 'health' | 'photo' | 'quiz' | 'gate' | 'engine';

export interface GameEvent {
  playerId: string;
  /** e.g. 'rep', 'xp', 'penalty', 'quest.complete', 'quest.fail', 'levelup', 'health.steps' */
  kind: string;
  stat?: Stat | null;
  value?: number;
  verified?: boolean;
  source: EventSource;
  ts?: Date;
  /** Free-form context (e.g. a photo verdict's reason). Stored in `events.detail` (jsonb). */
  detail?: Record<string, unknown>;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  rank: Player['rank'];
  level: number;
  xp: number;
}

export interface StatHistoryRow {
  day: string; // ISO date (YYYY-MM-DD)
  stat: Stat;
  xp: number;
}

const globalForDb = globalThis as typeof globalThis & { __awakenPool?: Pool | null };

/** pg treats `sslmode=require` in the URL as verify-full, which rejects Tiger's chain — drop it and set ssl ourselves. */
export function connectionStringWithoutSslMode(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.TIGER_DATABASE_URL);
}

function getPool(): Pool | null {
  if (globalForDb.__awakenPool !== undefined) return globalForDb.__awakenPool;
  const url = process.env.TIGER_DATABASE_URL;
  const pool = url
    ? new Pool({
        connectionString: connectionStringWithoutSslMode(url),
        ssl: { rejectUnauthorized: false },
        max: POOL_SIZE,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
      })
    : null;
  pool?.on('error', (error) => console.error('[db] idle client error', error.message));
  globalForDb.__awakenPool = pool;
  return pool;
}

/** Test hook: forget the pool so the next call re-reads the env. */
export function resetDb(): void {
  globalForDb.__awakenPool = undefined;
  detailColumnMissing = false;
}

async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[] | null> {
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

// ── Players ─────────────────────────────────────────────────────────────────

interface PlayerRow {
  id: string;
  name: string | null;
  rank: string | null;
  level: number | null;
  xp: number | null;
  stats: Record<string, unknown> | null;
  penalty: boolean | null;
}

function emptyStats(): Record<Stat, number> {
  return Object.fromEntries(StatSchema.options.map((s) => [s, 0])) as Record<Stat, number>;
}

/** Row → validated Player; missing stats default to 0. Returns null on a corrupt row. */
export function rowToPlayer(row: PlayerRow): Player | null {
  const parsed = PlayerSchema.safeParse({
    id: row.id,
    name: row.name ?? row.id,
    rank: row.rank === 'S' ? 'A' : (row.rank ?? 'E'), // S was retired; A is the top rank
    level: row.level ?? 1,
    xp: row.xp ?? 0,
    stats: { ...emptyStats(), ...(row.stats ?? {}) },
    penalty: row.penalty ?? false,
  });
  if (!parsed.success) {
    console.error(`[db] player ${row.id} has invalid data`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

export async function upsertPlayer(player: Player): Promise<void> {
  await query(
    `INSERT INTO players (id, name, rank, level, xp, stats, penalty)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, rank = EXCLUDED.rank, level = EXCLUDED.level,
       xp = EXCLUDED.xp, stats = EXCLUDED.stats, penalty = EXCLUDED.penalty`,
    [player.id, player.name, player.rank, player.level, player.xp, JSON.stringify(player.stats), player.penalty],
  );
}

export async function getPlayer(id: string): Promise<Player | null> {
  const rows = await query<PlayerRow>(
    'SELECT id, name, rank, level, xp, stats, penalty FROM players WHERE id = $1',
    [id],
  );
  return rows?.[0] ? rowToPlayer(rows[0]) : null;
}

/** All players (for the daily drop after a restart). */
export async function listPlayers(limit = 100): Promise<Player[]> {
  const rows = await query<PlayerRow>(
    'SELECT id, name, rank, level, xp, stats, penalty FROM players ORDER BY created_at ASC LIMIT $1',
    [limit],
  );
  return (rows ?? []).map(rowToPlayer).filter((p): p is Player => p !== null);
}

export type PlayerPatch = Partial<Omit<Player, 'id'>>;

/** Column for each patchable field — the whitelist that keeps the dynamic SET safe. */
const PATCH_COLUMNS: Record<keyof PlayerPatch, string> = {
  name: 'name',
  rank: 'rank',
  level: 'level',
  xp: 'xp',
  stats: 'stats',
  penalty: 'penalty',
};

/** Updates the given fields and returns the new player (null if missing or DB off). */
export async function updatePlayer(id: string, patch: PlayerPatch): Promise<Player | null> {
  const fields = (Object.keys(patch) as (keyof PlayerPatch)[]).filter(
    (key) => key in PATCH_COLUMNS && patch[key] !== undefined,
  );
  if (fields.length === 0) return getPlayer(id);

  const sets = fields.map((key, i) => `${PATCH_COLUMNS[key]} = $${i + 2}`);
  const values = fields.map((key) => (key === 'stats' ? JSON.stringify(patch.stats) : patch[key]));
  const rows = await query<PlayerRow>(
    `UPDATE players SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, name, rank, level, xp, stats, penalty`,
    [id, ...values],
  );
  return rows?.[0] ? rowToPlayer(rows[0]) : null;
}

// ── Events ──────────────────────────────────────────────────────────────────

let warnedLogFailure = false;
let detailColumnMissing = false;

/** Postgres "undefined_column": `events.detail` hasn't been added yet (npm run db:migrate). */
const UNDEFINED_COLUMN = '42703';

function insertEvent(event: GameEvent, withDetail: boolean): Promise<unknown> {
  const params: unknown[] = [
    event.ts ?? new Date(),
    event.playerId,
    event.stat ?? null,
    event.kind,
    event.value ?? 1,
    event.verified ?? true,
    event.source,
  ];
  if (!withDetail) {
    return query(
      `INSERT INTO events (ts, player_id, stat, kind, value, verified, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      params,
    );
  }
  return query(
    `INSERT INTO events (ts, player_id, stat, kind, value, verified, source, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...params, JSON.stringify(event.detail)],
  );
}

async function insertWithFallback(event: GameEvent): Promise<void> {
  const withDetail = event.detail !== undefined && !detailColumnMissing;
  try {
    await insertEvent(event, withDetail);
  } catch (error) {
    if (!withDetail || (error as { code?: string }).code !== UNDEFINED_COLUMN) throw error;
    detailColumnMissing = true;
    console.warn('[db] events.detail column missing — run `npm run db:migrate`; logging without detail');
    await insertEvent(event, false);
  }
}

/** Fire-and-forget insert into `events`. Never throws; logs the first failure of an outage. */
export function logEvent(event: GameEvent): void {
  insertWithFallback(event)
    .then(() => {
      warnedLogFailure = false;
    })
    .catch((error: unknown) => {
      if (!warnedLogFailure) console.error('[db] logEvent failed:', error instanceof Error ? error.message : error);
      warnedLogFailure = true;
    });
}

/** Idempotent, additive schema changes on top of SPEC's tables. Null when no database. */
export async function migrate(): Promise<string[] | null> {
  const statements = ['ALTER TABLE events ADD COLUMN IF NOT EXISTS detail jsonb'];
  for (const sql of statements) {
    if ((await query(sql)) === null) return null;
  }
  detailColumnMissing = false;
  return statements;
}

// ── Demo reset ──────────────────────────────────────────────────────────────

export interface DemoDeleteResult {
  players: number;
  events: number;
}

/**
 * Deletes ONLY test/demo players (ids matching DEMO_PLAYER_ID_PATTERN) and their events,
 * in one transaction. Null when the DB is not configured.
 */
export async function deleteDemoPlayers(): Promise<DemoDeleteResult | null> {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events = await client.query('DELETE FROM events WHERE player_id ~* $1', [DEMO_PLAYER_ID_PATTERN]);
    const players = await client.query('DELETE FROM players WHERE id ~* $1', [DEMO_PLAYER_ID_PATTERN]);
    await client.query('COMMIT');
    return { players: players.rowCount ?? 0, events: events.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Reads for the dashboard ─────────────────────────────────────────────────

export async function leaderboard(limit = LEADERBOARD_SIZE): Promise<LeaderboardRow[]> {
  const rows = await query<PlayerRow>(
    `SELECT id, name, rank, level, xp, stats, penalty FROM players
     ORDER BY xp DESC, created_at ASC LIMIT $1`,
    [limit],
  );
  return (rows ?? [])
    .map(rowToPlayer)
    .filter((p): p is Player => p !== null)
    .map(({ id, name, rank, level, xp }) => ({ id, name, rank, level, xp }));
}

/** XP per stat per day for the last `days` days (from the daily_xp continuous aggregate). */
export async function statHistory(playerId: string, days = HISTORY_DAYS): Promise<StatHistoryRow[]> {
  const rows = await query<{ day: Date; stat: string; xp: number | string }>(
    `SELECT day, stat, xp FROM daily_xp
     WHERE player_id = $1 AND day >= now() - make_interval(days => $2)
     ORDER BY day ASC, stat ASC`,
    [playerId, days],
  );
  return (rows ?? []).flatMap((row) => {
    const stat = StatSchema.safeParse(row.stat);
    if (!stat.success) return [];
    return [{ day: new Date(row.day).toISOString().slice(0, 10), stat: stat.data, xp: Number(row.xp) }];
  });
}
