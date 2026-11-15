import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pollySend = vi.fn();
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {
    send = pollySend;
  },
  SynthesizeSpeechCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { resetPolly } from '../aws/polly';
import { readCachedVoice, resetTts, speak, voiceFileName } from './tts';

const ENV = {
  AWS: { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret' },
  ELEVEN: { ELEVENLABS_API_KEY: 'xi_test', ELEVENLABS_VOICE_ID: 'iris-voice' },
};
const ALL_KEYS = [...Object.keys(ENV.AWS), ...Object.keys(ENV.ELEVEN), 'VOICE_CACHE_DIR', 'POLLY_VOICE', 'ELEVENLABS_MODEL'];
const mp3 = (bytes: number[]) => ({ AudioStream: { transformToByteArray: async () => new Uint8Array(bytes) } });
const LINE = '[sighs] Ascension. [whispers] …Acceptable.';

describe('Iris TTS chain: ElevenLabs → Polly → browser', () => {
  let dir: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTts();
    resetPolly();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dir = await mkdtemp(path.join(os.tmpdir(), 'awaken-tts-test-'));
    process.env.VOICE_CACHE_DIR = dir;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const key of ALL_KEYS) delete process.env[key];
    await rm(dir, { recursive: true, force: true });
  });

  it('nothing configured → null (browser speech)', async () => {
    expect(await speak(LINE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pollySend).not.toHaveBeenCalled();
  });

  it('ElevenLabs first, with the audio tags and eleven_v3; cached afterwards', async () => {
    Object.assign(process.env, ENV.ELEVEN, ENV.AWS);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const url = await speak(LINE);
    const again = await speak(LINE);

    expect(url).toMatch(/^\/api\/voice\/[a-f0-9]{64}\.mp3$/);
    expect(again).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.elevenlabs.io/v1/text-to-speech/iris-voice?output_format=mp3_44100_128');
    expect(init.headers['xi-api-key']).toBe('xi_test');
    expect(JSON.parse(init.body)).toEqual({ text: LINE, model_id: 'eleven_v3' });
    expect(pollySend).not.toHaveBeenCalled();
    expect([...((await readCachedVoice(url!.split('/').pop()!)) ?? [])]).toEqual([1, 2, 3]);
  });

  it('ElevenLabs failing → Polly with the tags stripped', async () => {
    Object.assign(process.env, ENV.ELEVEN, ENV.AWS, { POLLY_VOICE: 'Gregory' });
    fetchMock.mockResolvedValue(new Response('quota exceeded', { status: 401 }));
    pollySend.mockResolvedValue(mp3([9]));

    expect(await speak(LINE)).toMatch(/\.mp3$/);
    expect(pollySend.mock.calls[0][0].input).toMatchObject({ Engine: 'neural', VoiceId: 'Gregory', Text: 'Ascension. …Acceptable.' });
  });

  it('a pre-generated file is used even with no provider configured', async () => {
    const name = voiceFileName('polly', 'Matthew|neural', 'Ascension. …Acceptable.');
    await writeFile(path.join(dir, name), 'x');

    expect(await speak(LINE)).toBe(`/api/voice/${name}`);
  });

  it('concurrent requests for one line share one synthesis', async () => {
    Object.assign(process.env, ENV.ELEVEN);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    const [a, b] = await Promise.all([speak(LINE), speak(LINE)]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache reads reject anything but a hash file name', async () => {
    expect(await readCachedVoice('../../etc/passwd')).toBeNull();
    expect(await readCachedVoice(`${'a'.repeat(64)}.mp3`)).toBeNull();
  });
});
