import { beforeEach, describe, expect, it, vi } from 'vitest';

/** upsertWallet calls that finish in reverse order (a slow pool connection), recorded as they land. */
const landed: { earned: number }[] = [];
vi.mock('./db', () => ({
  getWallet: vi.fn().mockResolvedValue(null),
  upsertWallet: vi.fn(),
}));

import * as db from './db';
import { earnShards, loadWallet, peekWallet, resetWallets, spendShards } from './wallet';

describe('wallet persistence', () => {
  beforeEach(() => {
    landed.length = 0;
    (globalThis as { __awakenWallets?: unknown }).__awakenWallets = undefined;
    let delay = 40;
    vi.mocked(db.upsertWallet).mockReset().mockImplementation((wallet) => {
      const ms = delay;
      delay = Math.max(5, delay - 15); // each later write finishes sooner
      return new Promise((resolve) => setTimeout(() => {
        landed.push({ earned: wallet.earned });
        resolve();
      }, ms));
    });
  });

  it('the stored row ends up equal to memory even when writes finish out of order', async () => {
    await loadWallet('w1');
    earnShards('w1', 5);
    earnShards('w1', 5);
    earnShards('w1', 5);

    await vi.waitFor(() => expect(landed.at(-1)?.earned).toBe(peekWallet('w1').earned), { timeout: 1_000 });
    await new Promise((r) => setTimeout(r, 150)); // let any straggler land
    expect(landed.at(-1)?.earned).toBe(15);
  });
});

describe('wallet load on a slow or failing DB', () => {
  const stored = { playerId: 'w2', balance: 80, earned: 100, shields: 1, cosmetics: ['halo'], lastHalveAt: null };

  beforeEach(() => {
    resetWallets();
    vi.mocked(db.upsertWallet).mockReset().mockResolvedValue(undefined);
  });

  it('never stalls a kept vow: gives up on the DB after ~500 ms', async () => {
    vi.mocked(db.getWallet).mockReturnValueOnce(new Promise(() => undefined)); // hung connection

    const started = Date.now();
    await loadWallet('w2');

    expect(Date.now() - started).toBeLessThan(900);
  });

  it('a failed load never overwrites the stored wallet; the next good load merges what was earned meanwhile', async () => {
    vi.mocked(db.getWallet).mockRejectedValueOnce(new Error('connect timeout'));
    await loadWallet('w2');
    earnShards('w2', 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(db.upsertWallet).not.toHaveBeenCalled(); // would have stored earned: 5 over 100

    vi.mocked(db.getWallet).mockResolvedValueOnce(stored);
    const wallet = await loadWallet('w2');

    expect(wallet).toMatchObject({ balance: 85, earned: 105, shields: 1, cosmetics: ['halo'] });
    await vi.waitFor(() => expect(db.upsertWallet).toHaveBeenLastCalledWith(expect.objectContaining({ earned: 105, balance: 85 })));
    expect(spendShards('w2', 10)?.balance).toBe(75);
  });
});

