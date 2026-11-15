import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  latestCalibration: vi.fn().mockResolvedValue(null),
  getWallet: vi.fn().mockResolvedValue(null),
  upsertWallet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

import * as db from '../lib/db';
import { zeroProof } from '../lib/power';
import { earnShards, peekWallet, resetWallets } from '../lib/wallet';
import { group } from './constellations';
import { resetLedger } from './ledger';
import { ASCENSION_SHARDS, completeQuest, createPlayer, failQuest, getQuest, listQuests, resetEngine, startQuest, sweepExpired } from './quests';
import { resetRouter } from './router';
import { MAX_SHIELDS, PRICES, spend } from './shards';

describe('Shards (earn-only)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    resetLedger();
    resetWallets();
    await createPlayer({ name: 'Jin', id: 'p1' });
  });

  it('earned by keeping vows (1 per 10 Proof) and by Ascension; persisted', async () => {
    const quest = await startQuest('p1', { type: 'gate', difficulty: 'hard' }); // 120 Proof → level 3
    await completeQuest('p1', quest.id);

    expect(peekWallet('p1')).toMatchObject({ balance: 12 + ASCENSION_SHARDS, earned: 12 + ASCENSION_SHARDS });
    expect(db.upsertWallet).toHaveBeenCalled();
  });

  it('refuses a purchase without enough Shards; a shield is bought, capped, and absorbs a missed day', async () => {
    await expect(spend('p1', { item: 'shield' })).rejects.toThrow(/Not enough Shards/);
    earnShards('p1', PRICES.shield * 4);
    for (let i = 0; i < MAX_SHIELDS; i += 1) await spend('p1', { item: 'shield' });
    await expect(spend('p1', { item: 'shield' })).rejects.toThrow(/already hold 3/);

    const missed = await startQuest('p1', { type: 'photo', deadline: new Date(Date.now() - 1_000) });
    await sweepExpired(new Date());
    expect(getQuest(missed.id)?.status).toBe('cancelled'); // not failed: no Reckoning
    expect(listQuests('p1').some((q) => q.kind === 'penalty')).toBe(false);
    expect(peekWallet('p1').shields).toBe(MAX_SHIELDS - 1);
  });

  it('halves an active Reckoning vow, once a week', async () => {
    const quest = await startQuest('p1', { type: 'photo' });
    const { penaltyQuest } = await failQuest('p1', quest.id, 'Skipped');
    earnShards('p1', PRICES.halve * 2);

    const now = Date.now();
    const { detail } = await spend('p1', { item: 'halve', questId: penaltyQuest!.id }, now);
    expect((detail.quest as { target: number }).target).toBe(Math.ceil(penaltyQuest!.target / 2));
    await expect(spend('p1', { item: 'halve', questId: penaltyQuest!.id }, now + 1_000)).rejects.toThrow(/once a week/);
    await expect(spend('p1', { item: 'halve', questId: quest.id }, now + 8 * 86_400_000)).rejects.toThrow(/Reckoning vow/);
  });

  it('a bonus vow pays 1.5×; cosmetics are bought once', async () => {
    earnShards('p1', 1_000);
    const { detail } = await spend('p1', { item: 'bonus' });
    const bonus = detail.quest as { title: string; xp: number };
    expect(bonus.title).toMatch(/^\[BONUS\]/);

    await spend('p1', { item: 'cosmetic', cosmeticId: 'frame-ember' });
    await expect(spend('p1', { item: 'cosmetic', cosmeticId: 'frame-ember' })).rejects.toThrow(/already own/);
    await expect(spend('p1', { item: 'cosmetic', cosmeticId: 'nope' })).rejects.toThrow(/Unknown cosmetic/);
    expect(peekWallet('p1')).toMatchObject({ balance: 1_000 - PRICES.bonus - 100, cosmetics: ['frame-ember'] });
  });
});

describe('Constellations', () => {
  it('groups of 30 by Power; a small tail joins the group above', () => {
    expect(group(Array.from({ length: 65 }, (_, i) => i)).map((g) => g.length)).toEqual([30, 35]);
    expect(group(Array.from({ length: 80 }, (_, i) => i)).map((g) => g.length)).toEqual([30, 30, 20]);
    expect(group([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(zeroProof().STR).toBe(0);
  });
});
