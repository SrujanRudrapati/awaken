/**
 * The System's long-term memory (Supermemory v5). One namespace per player: `player_<id>`.
 * Stores goals, per-quest summaries and milestones; recalls short context for the quest
 * designer and the voice. Everything is optional and failure-proof: no key, timeout or API
 * error → remember() returns false / recall() returns null, and callers carry on without it.
 */
import { Supermemory } from 'supermemory';

export const RECALL_TIMEOUT_MS = 2_000;
const REMEMBER_TIMEOUT_MS = 8_000;
/** Recalls are reused this long (per player + query) so hot paths like the voice stay fast. */
export const RECALL_CACHE_MS = 5 * 60_000;
const RECALL_LIMIT = 5;
const MAX_ITEM_CHARS = 200;
const MAX_RECALL_CHARS = 700;
const MAX_CONTENT_CHARS = 2_000;

export type MemoryKind = 'goal' | 'quest' | 'milestone';
type MetadataValue = string | number | boolean;

interface MemoryState {
  client?: Supermemory;
  cache: Map<string, { at: number; value: string | null }>;
}
const globalForMemory = globalThis as typeof globalThis & { __awakenMemory?: MemoryState };
function state(): MemoryState {
  globalForMemory.__awakenMemory ??= { cache: new Map() };
  return globalForMemory.__awakenMemory;
}

export function isMemoryConfigured(): boolean {
  return Boolean(process.env.SUPERMEMORY_API_KEY);
}

function client(): Supermemory | null {
  if (!isMemoryConfigured()) return null;
  state().client ??= new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY, maxRetries: 0 });
  return state().client ?? null;
}

/** `player_<id>`, restricted to a safe character set (ids are user-supplied). */
export function playerNamespace(playerId: string): string {
  return `player_${playerId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`;
}

function logFailure(action: string, error: unknown): void {
  console.error(`[memory] ${action} failed:`, error instanceof Error ? error.message : error);
}

function forgetCached(playerId: string): void {
  const prefix = `${playerNamespace(playerId)}|`;
  for (const key of state().cache.keys()) if (key.startsWith(prefix)) state().cache.delete(key);
}

export interface RememberOptions {
  kind: MemoryKind;
  metadata?: Record<string, MetadataValue>;
  /** Process right away (goals) instead of Supermemory's batched "dynamic" mode. */
  instant?: boolean;
}

/** Saves one fact about the player. Never throws; false if not saved. */
export async function remember(playerId: string, content: string, options: RememberOptions): Promise<boolean> {
  const sm = client();
  const text = content.trim().slice(0, MAX_CONTENT_CHARS);
  if (!sm || !text) return false;
  try {
    await sm.add(
      playerNamespace(playerId),
      {
        content: text,
        metadata: { kind: options.kind, ...options.metadata },
        date: new Date().toISOString(),
        dreaming: options.instant ? 'instant' : 'dynamic',
      },
      { abortSignal: AbortSignal.timeout(REMEMBER_TIMEOUT_MS) },
    );
    forgetCached(playerId);
    return true;
  } catch (error) {
    logFailure('remember', error);
    return false;
  }
}

/** Pure: search results → one short context string ("a; b; c"), or null if nothing useful. */
export function formatRecall(results: readonly { memory?: string; chunk?: string }[]): string | null {
  const items = [...new Set(results.map((r) => (r.memory ?? r.chunk ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (items.length === 0) return null;
  const joined = items.map((item) => item.slice(0, MAX_ITEM_CHARS)).join('; ');
  return joined.slice(0, MAX_RECALL_CHARS);
}

/** What the System remembers about the player that's relevant to `query`, or null. */
export async function recall(playerId: string, query: string, timeoutMs = RECALL_TIMEOUT_MS): Promise<string | null> {
  const sm = client();
  if (!sm) return null;
  const key = `${playerNamespace(playerId)}|${query}`;
  const cached = state().cache.get(key);
  if (cached && Date.now() - cached.at < RECALL_CACHE_MS) return cached.value;
  try {
    const { results } = await sm.search(
      playerNamespace(playerId),
      { query, limit: RECALL_LIMIT },
      { abortSignal: AbortSignal.timeout(timeoutMs) },
    );
    const value = formatRecall(results);
    state().cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    logFailure('recall', error);
    return null;
  }
}

/** Test hook. */
export function resetMemory(): void {
  globalForMemory.__awakenMemory = undefined;
}
