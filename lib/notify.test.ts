import { afterEach, describe, expect, it, vi } from 'vitest';
import { push } from './notify';

describe('notify.push', () => {
  afterEach(() => {
    delete process.env.NTFY_TOPIC;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is a no-op without NTFY_TOPIC', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await push({ title: 'x', message: 'y' })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs title/priority/tags headers and the message body to the topic', async () => {
    process.env.NTFY_TOPIC = 'awaken-topic';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await push({ title: '[LEVEL UP] → D', message: 'Rank D', priority: 'high', tags: ['zap'] })).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.sh/awaken-topic');
    expect(init).toMatchObject({ method: 'POST', body: 'Rank D', headers: { Title: '[LEVEL UP]  D', Priority: 'high', Tags: 'zap' } });
  });

  it('never throws when ntfy is down or refuses', async () => {
    process.env.NTFY_TOPIC = 't';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await push({ title: 'a', message: 'b' })).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    expect(await push({ title: 'a', message: 'b' })).toBe(false);
  });
});
