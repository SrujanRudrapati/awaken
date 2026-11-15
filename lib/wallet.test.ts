import { beforeEach, describe, expect, it, vi } from 'vitest';

/** upsertWallet calls that finish in reverse order (a slow pool connection), recorded as they land. */
const landed: { earned: number }[] = [];
vi.mock('./db', () => ({
  getWallet: vi.fn().mockResolvedValue(null),
  upsertWallet: vi.fn(),
}));

import * as db from './db';
import { earnShards, loadWallet, peekWallet } from './wallet';

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
