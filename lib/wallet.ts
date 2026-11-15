/**
 * Shards wallet (earn-only currency — no purchases). Memory is authoritative while the server
 * runs; each wallet is loaded from Tiger `wallets` on first use (≤ 500 ms) and written back
 * (full row, in order) after every change. If the stored row cannot be read, nothing is written
 * until a later load succeeds and merges what was earned meanwhile. Callers `await loadWallet()` before the sync helpers below.
 */
import * as db from './db';
import { createLatestWriter } from './latestWriter';

export interface Wallet {
  playerId: string;
  balance: number;
  earned: number;
  shields: number;
  cosmetics: string[];
  lastHalveAt: string | null;
}

const globalForWallet = globalThis as typeof globalThis & { __awakenWallets?: Map<string, Wallet> };
function wallets(): Map<string, Wallet> {
  globalForWallet.__awakenWallets ??= new Map();
  return globalForWallet.__awakenWallets;
}

const empty = (playerId: string): Wallet => ({ playerId, balance: 0, earned: 0, shields: 0, cosmetics: [], lastHalveAt: null });

/** Full-row upserts, in order per wallet (the newest row is always the last to land). */
const writeWallet = createLatestWriter<Wallet>(
  'wallet',
  (wallet) => db.upsertWallet(wallet),
  (playerId, error) => console.error(`[wallet] persist failed for ${playerId}:`, error instanceof Error ? error.message : error),
);

function persist(wallet: Wallet): void {
  if (unsynced().has(wallet.playerId)) return; // stored row unknown: writing would overwrite it
  writeWallet(wallet.playerId, wallet);
}

/** A kept vow must never wait on a slow DB for its Shards (same cap as baselines). */
export const WALLET_LOOKUP_TIMEOUT_MS = 500;
const FAILED = Symbol('failed');

/** Wallets whose stored row could not be read: memory holds only what changed since (merged on the next good load). */
const globalForUnsynced = globalThis as typeof globalThis & { __awakenUnsyncedWallets?: Set<string> };
function unsynced(): Set<string> {
  globalForUnsynced.__awakenUnsyncedWallets ??= new Set();
  return globalForUnsynced.__awakenUnsyncedWallets;
}

async function readStored(playerId: string): Promise<Wallet | null | typeof FAILED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof FAILED>((resolve) => {
    timer = setTimeout(() => resolve(FAILED), WALLET_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([db.getWallet(playerId), timeout]);
  } catch {
    return FAILED;
  } finally {
    clearTimeout(timer);
  }
}

/** Stored row + what changed in memory while it was unreadable (memory started from empty). */
function merge(stored: Wallet, changes: Wallet): Wallet {
  const halves = [stored.lastHalveAt, changes.lastHalveAt].filter((d): d is string => d !== null).sort();
  return {
    playerId: stored.playerId,
    balance: stored.balance + changes.balance,
    earned: stored.earned + changes.earned,
    shields: stored.shields + changes.shields,
    cosmetics: [...new Set([...stored.cosmetics, ...changes.cosmetics])],
    lastHalveAt: halves.at(-1) ?? null,
  };
}

export async function loadWallet(playerId: string): Promise<Wallet> {
  const cached = wallets().get(playerId);
  if (cached && !unsynced().has(playerId)) return cached;
  const stored = await readStored(playerId);
  const current = wallets().get(playerId);
  if (current && !unsynced().has(playerId)) return current; // another call loaded it meanwhile
  if (stored === FAILED) {
    if (current) return current;
    const placeholder = empty(playerId);
    wallets().set(playerId, placeholder);
    unsynced().add(playerId);
    return placeholder;
  }
  const base = stored ?? empty(playerId);
  const wallet = current ? merge(base, current) : base;
  wallets().set(playerId, wallet);
  const hadChanges = unsynced().delete(playerId) && current !== undefined;
  if (hadChanges) persist(wallet);
  return wallet;
}

/** The in-memory wallet (empty if never loaded). */
export function peekWallet(playerId: string): Wallet {
  return wallets().get(playerId) ?? empty(playerId);
}

function update(playerId: string, change: (w: Wallet) => Wallet): Wallet {
  const next = change(peekWallet(playerId));
  wallets().set(playerId, next);
  persist(next);
  return next;
}

export function earnShards(playerId: string, amount: number): Wallet {
  const gain = Math.max(0, Math.round(amount));
  return update(playerId, (w) => ({ ...w, balance: w.balance + gain, earned: w.earned + gain }));
}

/** Debits `cost` and applies `change`; null (nothing changed) if the balance is too low. */
export function spendShards(playerId: string, cost: number, change: (w: Wallet) => Wallet = (w) => w): Wallet | null {
  if (peekWallet(playerId).balance < cost) return null;
  return update(playerId, (w) => change({ ...w, balance: w.balance - cost }));
}

/** Uses one streak shield if there is one. */
export function consumeShield(playerId: string): boolean {
  if (peekWallet(playerId).shields <= 0) return false;
  update(playerId, (w) => ({ ...w, shields: w.shields - 1 }));
  return true;
}

/** Forgets matching wallets in memory (demo reset; Tiger rows are deleted by db.deleteDemoPlayers). */
export function forgetWallets(shouldForget: (playerId: string) => boolean): void {
  [...wallets().keys()].filter(shouldForget).forEach((id) => wallets().delete(id));
  [...unsynced()].filter(shouldForget).forEach((id) => unsynced().delete(id));
}

/** Test hook. */
export function resetWallets(): void {
  globalForWallet.__awakenWallets = undefined;
  globalForUnsynced.__awakenUnsyncedWallets = undefined;
}
