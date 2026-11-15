import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

import { subscribe } from '../lib/bus';
import * as db from '../lib/db';
import type { StreamEvent } from '../lib/schemas';
import { syncHealth } from './health';
import { createPlayer, getPlayer, getQuest, resetEngine, startQuest } from './quests';
import { resetRouter } from './router';

describe('syncHealth', () => {
  let events: StreamEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    events = [];
    subscribe((e) => events.push(e));
  });

  it('completes quests whose metric reached the target and awards XP', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const steps = await startQuest('p1', { type: 'steps' }); // 8000
    const run = await startQuest('p1', { type: 'run' }); // 3 km

    const result = await syncHealth('p1', { steps: 9000, distanceKm: 3.2 });

    expect(result.completed.map((q) => q.id).sort()).toEqual([steps.id, run.id].sort());
    expect(getQuest(steps.id)?.status).toBe('done');
    expect((await getPlayer('p1'))?.xp).toBe(steps.xp + run.xp);
    expect(events).toContainEqual(expect.objectContaining({ type: 'voice', text: 'Health data verified. Quest complete.' }));
  });

  it('records partial progress without completing, and never lowers it', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const steps = await startQuest('p1', { type: 'steps' });

    await syncHealth('p1', { steps: 5200 });
    await syncHealth('p1', { steps: 3000 }); // stale Shortcut run

    expect(getQuest(steps.id)).toMatchObject({ status: 'active', progress: 5200 });
  });

  it('ignores sensor quests, other metrics and expired quests', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const pushup = await startQuest('p1', { type: 'pushup' });
    const sleep = await startQuest('p1', { type: 'sleep', deadline: new Date(Date.now() - 1_000) });

    const result = await syncHealth('p1', { steps: 99_999, sleepHours: 9 });

    expect(result.completed).toEqual([]);
    expect(getQuest(pushup.id)?.status).toBe('active');
    expect(getQuest(sleep.id)?.status).toBe('active'); // the midnight sweep fails it, not Health
  });

  it('logs every metric it was given to Tiger', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });

    await syncHealth('p1', { steps: 100, avgHeartRate: 70 });

    expect(db.logEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'health.steps', value: 100, source: 'health' }));
    expect(db.logEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'health.avgHeartRate', value: 70 }));
  });

  it('404s for an unknown player', async () => {
    await expect(syncHealth('ghost', { steps: 1 })).rejects.toMatchObject({ status: 404 });
  });
});
