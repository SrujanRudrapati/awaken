import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  statHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/ai/claude', () => ({ claudeJson: vi.fn() }));

import { claudeJson } from '../../lib/ai/claude';
import * as db from '../../lib/db';
import { OPUS } from '../../lib/models';
import type { Quest } from '../../lib/schemas';
import { createPlayer, resetEngine } from '../quests';
import { MIN_FRESH_MS, resetBoss, weekFacts, weeklyReport } from './boss';

const NOW = new Date('2030-01-08T12:00:00Z');
const history = [
  { day: '2030-01-02', stat: 'STR' as const, xp: 60 },
  { day: '2030-01-03', stat: 'STR' as const, xp: 30 },
  { day: '2030-01-03', stat: 'INT' as const, xp: 20 },
];
const opusReport = {
  title: 'The Body Advances',
  verdict: 'Strength rises while the mind sleeps.',
  summary: 'Ninety strength. Twenty intellect. Two days of effort out of seven.',
  orders: ['Study daily.', 'Meditate at dawn.', 'Clear every quest.', 'extra order'],
};

describe('weekly boss report', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetEngine();
    resetBoss();
    vi.mocked(db.statHistory).mockResolvedValue(history);
    await createPlayer({ name: 'Jin', id: 'p1' });
  });

  it('computes the week in code', () => {
    const quest = (status: Quest['status'], deadline: string) => ({ status, deadline }) as Quest;
    const facts = weekFacts(history, [quest('done', '2030-01-07T23:59:00Z'), quest('failed', '2030-01-06T23:59:00Z'), quest('done', '2029-12-01T00:00:00Z')], NOW);

    expect(facts).toMatchObject({ totalXp: 110, strongest: 'STR', completed: 1, failed: 1, activeDays: 2 });
    expect(facts.xpByStat).toMatchObject({ STR: 90, INT: 20, CHA: 0 });
    expect(facts.weakest).not.toBe('STR');
  });

  it('asks Opus with the computed facts and keeps exactly 3 orders', async () => {
    vi.mocked(claudeJson).mockResolvedValue(opusReport);

    const result = await weeklyReport('p1', { now: NOW });

    expect(result.source).toBe('opus');
    expect(result.report.orders).toHaveLength(3);
    const [req] = vi.mocked(claudeJson).mock.calls[0];
    expect(req.model).toBe(OPUS);
    expect(req.prompt).toContain('STR 90');
  });

  it('falls back to a code-written report when Opus is offline or breaks format', async () => {
    vi.mocked(claudeJson).mockResolvedValue({ ...opusReport, orders: ['only one'] });

    const result = await weeklyReport('p1', { now: NOW });

    expect(result.source).toBe('fallback');
    expect(result.report.verdict).toContain('110 XP');
    expect(result.report.orders).toHaveLength(3);
  });

  it('caches per player; fresh re-runs only after the minimum gap', async () => {
    vi.mocked(claudeJson).mockResolvedValue(opusReport);

    await weeklyReport('p1', { now: NOW });
    await weeklyReport('p1', { now: new Date(NOW.getTime() + 60_000) });
    await weeklyReport('p1', { now: new Date(NOW.getTime() + 1_000), fresh: true });
    expect(claudeJson).toHaveBeenCalledTimes(1);

    await weeklyReport('p1', { now: new Date(NOW.getTime() + MIN_FRESH_MS + 1), fresh: true });
    expect(claudeJson).toHaveBeenCalledTimes(2);
  });

  it('unknown player → 404', async () => {
    await expect(weeklyReport('nobody')).rejects.toThrow(/No player/);
  });
});
