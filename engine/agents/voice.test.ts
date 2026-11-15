import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/llm', () => ({ claude: vi.fn() }));
vi.mock('../../lib/voice/tts', () => ({ speak: vi.fn(async () => null) }));
vi.mock('../../lib/memory', () => ({ recall: vi.fn(async () => null) }));

import { publish, subscribe } from '../../lib/bus';
import { speak } from '../../lib/voice/tts';
import { claude } from '../../lib/llm';
import { recall } from '../../lib/memory';
import type { Quest, StreamEvent } from '../../lib/schemas';
import { VOICE_WINDOW_MS, announceAwakening, startVoice, stopVoice } from './voice';
import { stripTags } from '../../lib/voice/tags';
import { CANNED_LINES, VOICE_MOODS, sanitizeLine, sentenceCount } from './voicePersona';

const quest = (over: Partial<Quest> = {}): Quest => ({
  id: 'q1', playerId: 'p1', stat: 'STR', title: 'Push-ups: 20 reps', type: 'pushup', target: 20, progress: 20,
  xp: 30, status: 'done', deadline: '2030-01-01T00:00:00Z', ...over,
});

describe('System voice', () => {
  let voices: Extract<StreamEvent, { type: 'voice' }>[];
  let off: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(claude).mockReset();
    voices = [];
    off = subscribe((e) => {
      if (e.type === 'voice') voices.push(e);
    });
    startVoice();
  });
  afterEach(() => {
    stopVoice();
    off();
    vi.useRealTimers();
  });

  it('a level-up outranks the quest completion that caused it: one line, from Haiku', async () => {
    vi.mocked(claude).mockResolvedValue('Rank D confirmed. You are no longer weak.');

    publish({ type: 'quest.complete', quest: quest(), xpGained: 30 });
    publish({ type: 'levelup', playerId: 'p1', fromRank: 'E', toRank: 'D', level: 3 });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices).toEqual([{ type: 'voice', text: 'Rank D confirmed. You are no longer weak.', eventType: 'levelup', playerId: 'p1', irisMood: 'proud' }]);
    expect(vi.mocked(claude).mock.calls[0][0].prompt).toContain('rank E → D');
  });

  it('falls back to a canned line when the model is offline or rambles', async () => {
    vi.mocked(claude).mockResolvedValueOnce(null);
    publish({ type: 'penalty', playerId: 'p1', reason: 'Missed deadline' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    vi.mocked(claude).mockResolvedValueOnce('word '.repeat(30));
    publish({ type: 'penalty', playerId: 'p1', reason: 'Again' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices).toHaveLength(2);
    voices.forEach((v) => expect(CANNED_LINES.penalty.map(stripTags)).toContain(v.text));
  });

  it('announces a new emergency once, ignores its progress updates', async () => {
    vi.mocked(claude).mockResolvedValue(null);
    const emergency = quest({ id: 'e1', kind: 'emergency', status: 'active', progress: 0 });

    publish({ type: 'quest.update', quest: emergency });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);
    publish({ type: 'quest.update', quest: { ...emergency, progress: 3 } });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices.map((v) => v.eventType)).toEqual(['emergency']);
  });

  it('rep.rejected uses canned lines only, with a cooldown', async () => {
    publish({ type: 'rep.rejected', playerId: 'p1', questId: 'q1', reason: 'too fast' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);
    publish({ type: 'rep.rejected', playerId: 'p1', questId: 'q1', reason: 'too fast' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices).toHaveLength(1);
    expect(claude).not.toHaveBeenCalled();
  });

  it('announces a manual quest start once; penalty quests are left to the penalty line', async () => {
    vi.mocked(claude).mockResolvedValue(null);
    publish({ type: 'quest.update', quest: quest({ id: 'm1', status: 'active', progress: 0, kind: 'manual' }) });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);
    publish({ type: 'quest.update', quest: quest({ id: 'm1', status: 'active', progress: 3, kind: 'manual' }) });
    publish({ type: 'quest.update', quest: quest({ id: 'x1', status: 'active', progress: 0, kind: 'penalty' }) });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices.map((v) => v.eventType)).toEqual(['quest.start']);
    expect(CANNED_LINES['quest.start'].map(stripTags)).toContain(voices[0].text);
    expect(voices[0].irisMood).toBe('watching');
  });

  it('Calibration greeting: display text without tags, tagged line to TTS, audio URL + mood on the event', async () => {
    vi.mocked(claude).mockResolvedValue('[calm] Oath recorded. [dismissive] Try to impress me.');
    vi.mocked(speak).mockResolvedValueOnce(`/api/voice/${'a'.repeat(64)}.mp3`);

    announceAwakening('p9', 'Mina');
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices).toEqual([
      { type: 'voice', eventType: 'awakening', playerId: 'p9', text: 'Oath recorded. Try to impress me.', audioUrl: `/api/voice/${'a'.repeat(64)}.mp3`, irisMood: 'watching' },
    ]);
    expect(vi.mocked(speak).mock.calls[0][0]).toBe('[calm] Oath recorded. [dismissive] Try to impress me.'); // tags go to TTS only
    expect(vi.mocked(claude).mock.calls[0][0].prompt).toContain('Mina');
  });

  it('feeds what the System remembers about the player into the line', async () => {
    vi.mocked(recall).mockResolvedValueOnce('Failed squats twice this week');
    vi.mocked(claude).mockResolvedValue('You skipped squats twice. The Reckoning remembers.');

    publish({ type: 'penalty', playerId: 'p1', questId: 'q1', reason: 'Squats missed' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(vi.mocked(recall).mock.calls[0][0]).toBe('p1');
    expect(vi.mocked(claude).mock.calls[0][0].prompt).toContain('Failed squats twice this week');
    expect(voices[0].text).toBe('You skipped squats twice. The Reckoning remembers.');
  });

  it('startVoice twice does not double-speak', async () => {
    vi.mocked(claude).mockResolvedValue(null);
    startVoice();
    publish({ type: 'levelup', playerId: 'p1', fromRank: 'E', toRank: 'D', level: 3 });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);
    expect(voices).toHaveLength(1);
  });
});

describe('sanitizeLine', () => {
  it('keeps one clean line of ≤ 15 words, drops quotes, markdown and exclamation', () => {
    expect(sanitizeLine('"**Rise, Oathbearer!**"\nsecond line')).toBe('Rise, Oathbearer.');
    expect(sanitizeLine('Arise, Player.')).toBeNull(); // old-brand words never reach the speakers
    expect(sanitizeLine(Array.from({ length: 29 }, (_, i) => `w${i}`).join(' '))).toBeNull(); // > 28 words
    expect(sanitizeLine('One. Two. Three.')).toBeNull(); // > 2 sentences
    expect(sanitizeLine('[sighs] Fine… Acceptable.')).toBe('[sighs] Fine… Acceptable.'); // ellipsis is not a sentence break
    expect(sanitizeLine('[laughs] [calm] Done. [slowly] [sighs] Again.')).toBe('[calm] Done. [slowly] Again.'); // ≤ 2 allowed tags
    expect(sanitizeLine('   ')).toBeNull();
  });

  it('every canned line passes sanitizeLine (≤ 2 sentences, ≤ 2 tags) and has a mood', () => {
    Object.values(CANNED_LINES).flat().forEach((line) => {
      expect(sanitizeLine(line)).toBe(line);
      expect(sentenceCount(stripTags(line))).toBeLessThanOrEqual(2);
    });
    expect(Object.keys(VOICE_MOODS).sort()).toEqual(Object.keys(CANNED_LINES).sort());
  });
});
