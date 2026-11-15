import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/memory', () => ({ isMemoryConfigured: vi.fn(() => true), remember: vi.fn(async () => true) }));

import { publish } from '../../lib/bus';
import { isMemoryConfigured, remember } from '../../lib/memory';
import type { Quest } from '../../lib/schemas';
import { entryFor, startChronicle, stopChronicle } from './chronicle';

const quest = (over: Partial<Quest> = {}): Quest => ({
  id: 'q1', playerId: 'p1', stat: 'STR', title: 'Squats: 20 reps', type: 'squat', target: 20, progress: 7,
  xp: 30, status: 'failed', deadline: '2030-01-01T00:00:00Z', kind: 'daily', ...over,
});

describe('chronicle → Supermemory', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => stopChronicle());

  it('records a failure once with how far the player got', () => {
    const seen = new Set<string>();
    const entry = entryFor({ type: 'quest.update', quest: quest() }, seen);

    expect(entry?.content).toMatch(/BROKE vow "Squats: 20 reps" \(squat, Body, daily\) — reached 7 of 20/);
    expect(entry?.metadata).toEqual({ outcome: 'failed', questType: 'squat', stat: 'STR' });
    expect(entryFor({ type: 'quest.update', quest: quest() }, seen)).toBeNull();
  });

  it('records clears and rank-ups; ignores progress and noise', () => {
    const seen = new Set<string>();
    expect(entryFor({ type: 'quest.complete', quest: quest({ status: 'done' }), xpGained: 30 }, seen)?.content).toMatch(/Kept vow .* for 30 Proof/);
    expect(entryFor({ type: 'levelup', playerId: 'p1', fromRank: 'E', toRank: 'D', level: 3 }, seen)?.content).toMatch(/level 3 and rank D \(from E\)/);
    expect(entryFor({ type: 'quest.update', quest: quest({ status: 'active' }) }, seen)).toBeNull();
    expect(entryFor({ type: 'rep', playerId: 'p1', questId: 'q1', count: 3 }, seen)).toBeNull();
  });

  it('listens on the bus once started; off without a Supermemory key', () => {
    expect(startChronicle()).toBe(true);
    expect(startChronicle()).toBe(true); // idempotent
    publish({ type: 'quest.complete', quest: quest({ status: 'done' }), xpGained: 30 });
    expect(remember).toHaveBeenCalledTimes(1);
    expect(vi.mocked(remember).mock.calls[0][2]).toMatchObject({ kind: 'quest' });

    stopChronicle();
    vi.mocked(isMemoryConfigured).mockReturnValueOnce(false);
    expect(startChronicle()).toBe(false);
  });
});
