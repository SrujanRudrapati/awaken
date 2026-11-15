import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../engine/quests', () => ({ purgePlayers: vi.fn(), QuestError: class extends Error {} }));
vi.mock('../../../../lib/db', () => ({ deleteDemoPlayers: vi.fn() }));

import { purgePlayers } from '../../../../engine/quests';
import { deleteDemoPlayers } from '../../../../lib/db';
import { POST } from './route';

const post = (headers: Record<string, string> = {}): Request => new Request('http://x', { method: 'POST', headers });

describe('POST /api/demo/reset', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
  });

  it('needs the cron secret and touches nothing without it', async () => {
    process.env.CRON_SECRET = 's3cret';

    expect((await POST(post())).status).toBe(401);
    expect(purgePlayers).not.toHaveBeenCalled();
    expect(deleteDemoPlayers).not.toHaveBeenCalled();
  });

  it('purges only demo/test ids from memory and Tiger', async () => {
    process.env.CRON_SECRET = 's3cret';
    vi.mocked(purgePlayers).mockReturnValue(2);
    vi.mocked(deleteDemoPlayers).mockResolvedValue({ players: 2, events: 9 });

    const res = await POST(post({ authorization: 'Bearer s3cret' }));

    expect(await res.json()).toMatchObject({ data: { memoryPlayers: 2, tiger: { players: 2, events: 9 } } });
    const predicate = vi.mocked(purgePlayers).mock.calls[0][0];
    expect(['demo-1', 'test_x', 'jin', 'my-demo'].map(predicate)).toEqual([true, true, false, false]);
  });
});
