import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {
    send = send;
  },
  SynthesizeSpeechCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { readCachedVoice, resetPolly, speak, voiceFileName } from './polly';

const AWS_ENV = { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret' };
const mp3 = { AudioStream: { transformToByteArray: async () => new Uint8Array([0x49, 0x44, 0x33]) } };

describe('polly voice', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetPolly();
    dir = await mkdtemp(path.join(os.tmpdir(), 'awaken-voice-test-'));
    process.env.VOICE_CACHE_DIR = dir;
  });
  afterEach(async () => {
    for (const key of [...Object.keys(AWS_ENV), 'VOICE_CACHE_DIR', 'POLLY_VOICE']) delete process.env[key];
    await rm(dir, { recursive: true, force: true });
  });

  it('without AWS: null (browser speaks), unless the line is already cached', async () => {
    expect(await speak('Quest complete.')).toBeNull();

    await writeFile(path.join(dir, voiceFileName('Quest complete.')), 'x');
    expect(await speak('Quest complete.')).toBe(`/api/voice/${voiceFileName('Quest complete.')}`);
    expect(send).not.toHaveBeenCalled();
  });

  it('synthesizes once with the neural POLLY_VOICE, then serves from cache', async () => {
    Object.assign(process.env, AWS_ENV, { POLLY_VOICE: 'Gregory' });
    send.mockResolvedValue(mp3);

    const [a, b] = await Promise.all([speak('Rank up.'), speak('Rank up.')]); // concurrent → one call
    const again = await speak('Rank up.');

    expect(a).toBe(b);
    expect(again).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({ Engine: 'neural', OutputFormat: 'mp3', VoiceId: 'Gregory' });
    expect([...((await readCachedVoice(a!.split('/').pop()!)) ?? [])]).toEqual([0x49, 0x44, 0x33]);
  });

  it('Polly failure → null, so the event still goes out without audio', async () => {
    Object.assign(process.env, AWS_ENV);
    send.mockRejectedValue(new Error('ThrottlingException'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await speak('Penalty.')).toBeNull();
  });

  it('cache names depend on the voice, and reads reject anything but a hash file name', async () => {
    expect(voiceFileName('x', 'Matthew')).not.toBe(voiceFileName('x', 'Gregory'));
    expect(await readCachedVoice('../../etc/passwd')).toBeNull();
    expect(await readCachedVoice(`${'a'.repeat(64)}.mp3`)).toBeNull(); // valid name, not cached
  });
});
