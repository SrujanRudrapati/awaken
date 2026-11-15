/**
 * Shards wallet (earn-only currency — no purchases). Memory is authoritative while the server
 * runs; each wallet is loaded from Tiger `wallets` on first use and written back (full row)
 * after every change. Callers `await loadWallet()` before the sync helpers below.
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
  writeWallet(wallet.playerId, wallet);
}

export async function loadWallet(playerId: string): Promise<Wallet> {
  const cached = wallets().get(playerId);
  if (cached) return cached;
  let stored: Wallet | null = null;
  try {
    stored = await db.getWallet(playerId);
  } catch {
    stored = null;
  }
  const wallet = wallets().get(playerId) ?? stored ?? empty(playerId); // another call may have loaded it meanwhile
  wallets().set(playerId, wallet);
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
}

/** Test hook. */
export function resetWallets(): void {
  globalForWallet.__awakenWallets = undefined;
}
