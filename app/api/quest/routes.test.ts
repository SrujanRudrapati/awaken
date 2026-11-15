import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../../../engine/quests', async () => {
  class QuestError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    QuestError,
    createPlayer: vi.fn(),
    startQuest: vi.fn(),
    emergencyQuest: vi.fn(),
    getPlayer: vi.fn(),
    listQuests: vi.fn(),
    dailyDrop: vi.fn(),
  };
});

import * as engine from '../../../engine/quests';
import { POST as cronDaily } from '../cron/daily/route';
import { POST as createPlayerRoute } from '../player/route';
import { GET as questsRoute } from '../quests/[playerId]/route';
import { POST as emergencyRoute } from './emergency/route';
import { POST as startRoute } from './start/route';

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers });

describe('quest API routes', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('POST /api/player validates the name', async () => {
    vi.mocked(engine.createPlayer).mockResolvedValue({ id: 'p1' } as never);

    expect((await createPlayerRoute(post({ name: '' }))).status).toBe(400);
    expect((await createPlayerRoute(post({ name: 'Jin' }))).status).toBe(200);
    expect(engine.createPlayer).toHaveBeenCalledWith({ name: 'Jin' });
  });

  it('POST /api/quest/start accepts a new quest or a questId, rejects unknown types', async () => {
    vi.mocked(engine.startQuest).mockResolvedValue({ id: 'q' } as never);

    expect((await startRoute(post({ playerId: 'p1', type: 'pushup', target: 15 }))).status).toBe(200);
    expect(engine.startQuest).toHaveBeenLastCalledWith('p1', { type: 'pushup', target: 15 });
    expect((await startRoute(post({ playerId: 'p1', type: 'pushup', target: 1 }))).status).toBe(400); // XP farming
    expect((await startRoute(post({ playerId: 'p1', type: 'pushup', target: 10.5 }))).status).toBe(400);
    expect((await startRoute(post({ playerId: 'p1', questId: 'q9' }))).status).toBe(200);
    expect(engine.startQuest).toHaveBeenLastCalledWith('p1', { questId: 'q9' });
    expect((await startRoute(post({ playerId: 'p1', type: 'burpee' }))).status).toBe(400);
  });

  it('maps QuestError to its status', async () => {
    vi.mocked(engine.startQuest).mockRejectedValue(new engine.QuestError('No player ghost', 404));

    const res = await startRoute(post({ playerId: 'ghost', type: 'pushup' }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('No player ghost');
  });

  it('POST /api/quest/emergency defaults the exercise', async () => {
    vi.mocked(engine.emergencyQuest).mockResolvedValue({ id: 'e' } as never);

    expect((await emergencyRoute(post({ playerId: 'p1' }))).status).toBe(200);
    expect(engine.emergencyQuest).toHaveBeenCalledWith('p1', undefined);
  });

  it('GET /api/quests/:playerId 404s for unknown players', async () => {
    vi.mocked(engine.getPlayer).mockResolvedValue(null);

    const res = await questsRoute(new Request('http://x'), { params: Promise.resolve({ playerId: 'ghost' }) });

    expect(res.status).toBe(404);
  });

  it('POST /api/cron/daily requires the bearer secret when CRON_SECRET is set', async () => {
    vi.mocked(engine.dailyDrop).mockResolvedValue({ a: [{}, {}] } as never);
    process.env.CRON_SECRET = 's3cret';

    expect((await cronDaily(post({}))).status).toBe(401);
    const res = await cronDaily(post({}, { authorization: 'Bearer s3cret' }));
    expect(await res.json()).toMatchObject({ data: { players: 1, quests: { a: 2 } } });
  });
});
