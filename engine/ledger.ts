/**
 * Weekly Proof ledger (in memory, last 7 days) for the live leaderboard and `rank.passed`.
 * Tiger has the durable copy (`events` kind 'xp'); this one is instant and works offline.
 * Proof earned in DEMO_MODE is recorded as unverified and excluded unless asked for.
 */
const WEEK_MS = 7 * 24 * 60 * 60_000;

interface Entry {
  at: number;
  amount: number;
  verified: boolean;
}

interface LedgerState {
  entries: Map<string, Entry[]>;
  names: Map<string, string>;
}

const globalForLedger = globalThis as typeof globalThis & { __awakenLedger?: LedgerState };
function state(): LedgerState {
  globalForLedger.__awakenLedger ??= { entries: new Map(), names: new Map() };
  return globalForLedger.__awakenLedger;
}

export function recordProof(playerId: string, name: string, amount: number, verified: boolean, at = Date.now()): void {
  const s = state();
  s.names.set(playerId, name);
  const recent = (s.entries.get(playerId) ?? []).filter((e) => at - e.at < WEEK_MS);
  s.entries.set(playerId, [...recent, { at, amount, verified }]);
}

export function weeklyProof(playerId: string, includeDemo = false, now = Date.now()): number {
  return (state().entries.get(playerId) ?? [])
    .filter((e) => now - e.at < WEEK_MS && (includeDemo || e.verified))
    .reduce((sum, e) => sum + e.amount, 0);
}

export interface WeeklyRow {
  id: string;
  name: string;
  weeklyProof: number;
}

export function weeklyBoard(includeDemo = false, now = Date.now()): WeeklyRow[] {
  return [...state().entries.keys()]
    .map((id) => ({ id, name: state().names.get(id) ?? id, weeklyProof: weeklyProof(id, includeDemo, now) }))
    .sort((a, b) => b.weeklyProof - a.weeklyProof);
}

/** Players `playerId` overtook: they were at or above before and are strictly below now. */
export function passedBy(playerId: string, before: number, after: number, includeDemo = false, now = Date.now()): WeeklyRow[] {
  return weeklyBoard(includeDemo, now).filter((row) => row.id !== playerId && row.weeklyProof >= before && row.weeklyProof < after);
}

/** Forgets matching people (demo reset). */
export function forgetLedger(shouldForget: (playerId: string) => boolean): void {
  for (const id of [...state().entries.keys()]) {
    if (!shouldForget(id)) continue;
    state().entries.delete(id);
    state().names.delete(id);
  }
}

/** Test hook. */
export function resetLedger(): void {
  globalForLedger.__awakenLedger = undefined;
}
