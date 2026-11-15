import { afterEach, describe, expect, it, vi } from 'vitest';
import { playVoice } from './voicePlayback';

function fakeBrowser(play: () => Promise<void>) {
  const speak = vi.fn();
  vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
  vi.stubGlobal('Audio', class { play = play; });
  vi.stubGlobal('SpeechSynthesisUtterance', class { pitch = 1; rate = 1; constructor(public text: string) {} });
  return speak;
}

describe('voice playback (browser)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plays the Polly MP3 when there is one', async () => {
    const speak = fakeBrowser(async () => {});
    expect(await playVoice({ text: 'Rank up.', audioUrl: '/api/voice/a.mp3' })).toBe('audio');
    expect(speak).not.toHaveBeenCalled();
  });

  it('falls back to speechSynthesis with no audio or when playback is blocked', async () => {
    const speak = fakeBrowser(async () => {
      throw new Error('NotAllowedError');
    });
    expect(await playVoice({ text: 'Penalty.' })).toBe('speech');
    expect(await playVoice({ text: 'Penalty.', audioUrl: '/api/voice/a.mp3' })).toBe('speech');
    expect(speak.mock.calls[0][0]).toMatchObject({ text: 'Penalty.', pitch: 0.6 });
  });

  it('does nothing on the server', async () => {
    expect(await playVoice({ text: 'x' })).toBe('none');
  });
});
