import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handle, runDailyDrop, type AgentConfig } from './server';

const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  awakenUrl: 'https://awaken.example',
  cronSecret: 's3cret',
  dataDir: mkdtempSync(join(tmpdir(), 'maritime-')),
  replyWithinMs: 1_000,
  ...over,
});

const okDrop = () =>
  vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ success: true, data: { players: 2, quests: { a: 3, b: 4 } }, error: null }),
  );

describe('Maritime midnight agent', () => {
  it('calls POST /api/cron/daily with the CRON_SECRET bearer and logs the run under /data', async () => {
    const fetchFn = okDrop();
    const cfg = config();

    const run = await runDailyDrop(cfg, fetchFn);

    expect(fetchFn).toHaveBeenCalledWith('https://awaken.example/api/cron/daily', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer s3cret' }),
    }));
    expect(run).toMatchObject({ ok: true, players: 2, quests: 7 });
    const log = readFileSync(join(cfg.dataDir, 'runs.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(log[0])).toMatchObject({ ok: true, players: 2 });
  });

  it('reports a failed drop (e.g. 401 wrong secret) instead of pretending', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, data: null, error: 'Unauthorized' }, { status: 401 }));

    expect(await runDailyDrop(config(), fetchFn)).toMatchObject({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('refuses to run without AWAKEN_URL / CRON_SECRET', async () => {
    const fetchFn = okDrop();
    expect(await runDailyDrop(config({ cronSecret: '' }), fetchFn)).toMatchObject({ ok: false, error: expect.stringMatching(/CRON_SECRET/) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('GET /health is 200; POST /chat runs the drop and replies with a summary', async () => {
    const fetchFn = okDrop();
    const cfg = config();

    expect((await handle(new Request('http://agent/health'), cfg, fetchFn)).status).toBe(200);
    const reply = await handle(new Request('http://agent/chat', { method: 'POST', body: JSON.stringify({ message: 'run the midnight drop' }) }), cfg, fetchFn);

    expect(reply.status).toBe(200);
    expect((await reply.json()).response).toMatch(/Dropped 7 vows for 2 people/);
  });

  it('a "status" message reports the last run without dropping', async () => {
    const fetchFn = okDrop();
    const cfg = config();
    await runDailyDrop(cfg, fetchFn);
    fetchFn.mockClear();

    const reply = await handle(new Request('http://agent/chat', { method: 'POST', body: JSON.stringify({ message: 'status' }) }), cfg, fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
    expect((await reply.json()).response).toMatch(/Last run .*ok/);
  });

  it('answers /chat inside the 30 s limit even when the drop is slow (the run keeps going and is logged)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));

    const reply = await handle(new Request('http://agent/chat', { method: 'POST', body: '{"message":"go"}' }), config({ replyWithinMs: 20 }), fetchFn);

    expect((await reply.json()).response).toMatch(/still running/);
  });
});
