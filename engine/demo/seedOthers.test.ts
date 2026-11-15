import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  latestCalibration: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

import { isDemoPlayerId } from '../../lib/demo';
import { recordProof, resetLedger, weeklyBoard } from '../ledger';
import { createPlayer, getPlayer, resetEngine } from '../quests';
import { ARCHETYPES, seedOthers } from './seedOthers';

describe('demo:seed-others', () => {
  beforeEach(() => {
    resetEngine();
    resetLedger();
  });

  it('adds 9 mixed, removable profiles just above the demo person this week', async () => {
    await createPlayer({ name: 'Jin', id: 'demo-jin' });
    recordProof('demo-jin', 'Jin', 40, true);

    const { base, seeded } = await seedOthers('demo-jin');

    expect(base).toBe(40);
    expect(seeded).toHaveLength(ARCHETYPES.length);
    expect(seeded.every((s) => isDemoPlayerId(s.id) && s.weeklyProof > base)).toBe(true);
    expect(Math.min(...seeded.map((s) => s.weeklyProof))).toBe(48); // the closest is only 8 ahead
    const board = weeklyBoard();
    expect(board.at(-1)?.id).toBe('demo-jin');
    expect(new Set((await Promise.all(seeded.map((s) => getPlayer(s.id)))).map((p) => p?.rank)).size).toBeGreaterThan(1); // mixed ranks
  });
});
