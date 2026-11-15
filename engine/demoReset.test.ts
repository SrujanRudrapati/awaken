import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  insertPlayerIfAbsent: vi.fn().mockResolvedValue(true),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  latestCalibration: vi.fn().mockResolvedValue(null),
  getWallet: vi.fn().mockResolvedValue(null),
  upsertWallet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

import { getBaselines, resetBaselines, setBaselines } from '../lib/baselines';
import { isDemoPlayerId } from '../lib/demo';
import { earnShards, loadWallet, peekWallet, resetWallets } from '../lib/wallet';
import { resetDemoState } from './demoReset';
import { createPlayer, getPlayer, isRankUpArmed, resetEngine, startQuest } from './quests';
import { getActiveQuest, resetRouter } from './router';

describe('demo reset', () => {
  beforeEach(async () => {
    resetRouter();
    resetEngine();
    resetWallets();
    resetBaselines();
    for (const id of ['demo-judge', 'real-1']) {
      await createPlayer({ name: id, id });
      await loadWallet(id);
      earnShards(id, 25);
      setBaselines(id, { bodyReps: 30 });
      await startQuest(id, { type: 'squat' });
    }
  });

  it('forgets demo people, their wallets, baselines and sensor sessions; keeps real people', async () => {
    const result = resetDemoState(isDemoPlayerId);

    expect(result.memoryPlayers).toBe(1);
    expect(await getPlayer('demo-judge')).toBeNull();
    expect(peekWallet('demo-judge').balance).toBe(0);
    expect(await getBaselines('demo-judge')).toBeNull();
    expect(getActiveQuest('demo-judge')).toBeUndefined();

    expect(await getPlayer('real-1')).not.toBeNull();
    expect(peekWallet('real-1').balance).toBe(25);
    expect(await getBaselines('real-1')).toEqual({ bodyReps: 30 });
    expect(getActiveQuest('real-1')).toBeDefined();
  });

  it('re-arms the guaranteed rank-up', () => {
    expect(isRankUpArmed()).toBe(false);
    resetDemoState(isDemoPlayerId);
    expect(isRankUpArmed()).toBe(true);
  });
});
