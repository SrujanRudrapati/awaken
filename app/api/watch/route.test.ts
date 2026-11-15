import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));
vi.mock('../../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../lib/notify', () => ({ notify: vi.fn() }));

import { createPlayer, getPlayer, getQuest, resetEngine, startQuest } from '../../../engine/quests';
import { resetRouter } from '../../../engine/router';
import { POST } from './route';

const post = (body: unknown, token = 'tok'): Request =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'x-sync-token': token } });

const report = (count: number, exercise = 'squat', event = 'rep') => POST(post({ playerId: 'p1', event, exercise, count }));

describe('POST /api/watch', () => {
  beforeEach(async () => {
    process.env.SYNC_TOKEN = 'tok';
    resetRouter();
    resetEngine();
    await createPlayer({ name: 'Jin', id: 'p1' });
  });
  afterEach(() => {
    delete process.env.SYNC_TOKEN;
  });

  it('401 without the right sync token', async () => {
    expect((await POST(post({ playerId: 'p1', event: 'rep', exercise: 'squat', count: 1 }, 'nope'))).status).toBe(401);
  });

  it('adds only the increase of the cumulative count (lost + repeated posts self-correct)', async () => {
    const quest = await startQuest('p1', { type: 'squat', target: 15 });

    await report(1);
    await report(1); // retry of the same post
    const res = await report(4); // posts for 2 and 3 were lost

    expect(await res.json()).toMatchObject({ data: { applied: 3, progress: 4, completed: false } });
    expect(getQuest(quest.id)?.progress).toBe(4);
  });

  it('quest.complete with the final count finishes the quest and awards XP', async () => {
    const quest = await startQuest('p1', { type: 'punch', target: 30 });

    const res = await report(30, 'punch', 'quest.complete');

    expect(await res.json()).toMatchObject({ data: { completed: true } });
    await vi.waitFor(() => expect(getQuest(quest.id)?.status).toBe('done'));
    expect((await getPlayer('p1'))?.xp).toBe(quest.xp);
  });

  it('409 when the exercise does not match the active quest, or nothing is active', async () => {
    expect((await report(1)).status).toBe(409);
    await startQuest('p1', { type: 'squat', target: 15 });
    expect((await report(1, 'situp')).status).toBe(409);
  });

  it('400 on a malformed body', async () => {
    expect((await report(-1)).status).toBe(400);
    expect((await report(1, 'yoga')).status).toBe(400);
  });
});
