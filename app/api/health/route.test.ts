import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../engine/quests', () => ({ QuestError: class extends Error {} }));
vi.mock('../../../engine/health', () => ({ syncHealth: vi.fn() }));

import { syncHealth } from '../../../engine/health';
import { POST } from './route';

const post = (body: unknown, headers: Record<string, string> = { 'x-sync-token': 'tok' }): Request =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers });

describe('POST /api/health', () => {
  beforeEach(() => {
    process.env.SYNC_TOKEN = 'tok';
    vi.mocked(syncHealth).mockResolvedValue({ completed: [], progressed: [], leveledUp: false });
  });
  afterEach(() => {
    delete process.env.SYNC_TOKEN;
    delete process.env.HEALTH_PLAYER_ID;
    vi.clearAllMocks();
  });

  it('401 without the sync token, and the engine is not touched', async () => {
    expect((await POST(post({ playerId: 'p1' }, {}))).status).toBe(401);
    expect((await POST(post({ playerId: 'p1' }, { 'x-sync-token': 'bad' }))).status).toBe(401);
    expect(syncHealth).not.toHaveBeenCalled();
  });

  it('coerces Shortcut text numbers and passes the player through', async () => {
    const res = await POST(post({ playerId: 'p1', date: '2026-11-15', steps: '8123', sleepHours: 7.5 }));

    expect(res.status).toBe(200);
    expect(syncHealth).toHaveBeenCalledWith('p1', expect.objectContaining({ steps: 8123, sleepHours: 7.5 }));
  });

  it('falls back to HEALTH_PLAYER_ID, 400 when there is no player at all', async () => {
    expect((await POST(post({ steps: 1 }))).status).toBe(400);

    process.env.HEALTH_PLAYER_ID = 'me';
    expect((await POST(post({ steps: 1 }))).status).toBe(200);
    expect(syncHealth).toHaveBeenCalledWith('me', expect.anything());
  });

  it('rejects impossible values', async () => {
    expect((await POST(post({ playerId: 'p1', sleepHours: 30 }))).status).toBe(400);
    expect((await POST(post({ playerId: 'p1', steps: 'lots' }))).status).toBe(400);
  });
});
