import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  latestCalibration: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

import { setBaselines, resetBaselines } from '../lib/baselines';
import { subscribe } from '../lib/bus';
import * as db from '../lib/db';
import { zeroProof } from '../lib/power';
import type { StreamEvent } from '../lib/schemas';
import { resetLedger, weeklyBoard } from './ledger';
import { applyCalibration, completeQuest, createPlayer, getPlayer, purgePlayers, resetEngine, seedDemoPlayer, startQuest } from './quests';
import { resetRouter } from './router';

describe('rank.up, rank.passed and the weekly ledger', () => {
  let events: StreamEvent[];

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    resetLedger();
    resetBaselines();
    events = [];
    subscribe((e) => events.push(e));
    await createPlayer({ name: 'Jin', id: 'p1' });
  });
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('keeping a vow that overtakes someone publishes rank.passed', async () => {
    seedDemoPlayer({ id: 'demo-seed-a', name: 'Wren', proof: zeroProof(), weeklyProof: 50 });
    const quest = await startQuest('p1', { type: 'gate', difficulty: 'hard' }); // 120 Proof

    await completeQuest('p1', quest.id);

    expect(events).toContainEqual({ type: 'rank.passed', playerId: 'p1', passedId: 'demo-seed-a', passedName: 'Wren', weeklyProof: 120 });
    expect(weeklyBoard().map((r) => r.id)).toEqual(['p1', 'demo-seed-a']);
  });

  it('crossing a Power band publishes rank.up', async () => {
    await applyCalibration('p1', { stats: (await getPlayer('p1'))!.stats, proof: { ...zeroProof(), STR: 50, VIT: 50, INT: 50, FOCUS: 50 } });
    expect((await getPlayer('p1'))!.rank).toBe('E'); // 4 × √50 ≈ 28.3 < 30

    const run = await startQuest('p1', { type: 'run', difficulty: 'hard' }); // 80 Proof → VIT 130
    await completeQuest('p1', run.id);

    expect(events).toContainEqual(expect.objectContaining({ type: 'rank.up', playerId: 'p1', fromRank: 'E', toRank: 'D' }));
    expect((await getPlayer('p1'))!.rank).toBe('D');
  });

  it('Proof earned in DEMO_MODE is logged unverified and kept off the weekly board', async () => {
    process.env.DEMO_MODE = '1';
    seedDemoPlayer({ id: 'demo-seed-c', name: 'Hal', proof: zeroProof(), weeklyProof: 10 });
    const quest = await startQuest('p1', { type: 'gate', difficulty: 'hard' });

    await completeQuest('p1', quest.id);

    expect(db.logEvent).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'p1', kind: 'xp', verified: false }));
    expect(events.some((e) => e.type === 'rank.passed')).toBe(false);
    expect(weeklyBoard().find((r) => r.id === 'p1')?.weeklyProof).toBe(0);
    expect(weeklyBoard(true).find((r) => r.id === 'p1')?.weeklyProof).toBe(120);
  });

  it('rep vows scale to the Calibration baseline; demo reset forgets seeded people', async () => {
    setBaselines('p1', { bodyReps: 6 });
    const quest = await startQuest('p1', { type: 'photo' });
    const done = await completeQuest('p1', quest.id);
    expect(done.quest.xp).toBe(quest.xp); // photo is not a rep vow: unscaled

    seedDemoPlayer({ id: 'demo-seed-d', name: 'Kenji', proof: zeroProof(), weeklyProof: 5 });
    purgePlayers((id) => id.startsWith('demo-'));
    expect(weeklyBoard(true).some((r) => r.id === 'demo-seed-d')).toBe(false);
    expect(() => seedDemoPlayer({ id: 'real-person', name: 'X', proof: zeroProof(), weeklyProof: 1 })).toThrow(/demo-/);
  });
});
