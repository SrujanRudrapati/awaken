import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/llm', () => ({ claude: vi.fn() }));

import { publish, subscribe } from '../../lib/bus';
import { claude } from '../../lib/llm';
import type { Quest, StreamEvent } from '../../lib/schemas';
import { VOICE_WINDOW_MS, startVoice, stopVoice } from './voice';
import { CANNED_LINES, sanitizeLine } from './voicePersona';

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

    expect(voices).toEqual([{ type: 'voice', text: 'Rank D confirmed. You are no longer weak.', eventType: 'levelup', playerId: 'p1' }]);
    expect(vi.mocked(claude).mock.calls[0][0].prompt).toContain('Rank E → D');
  });

  it('falls back to a canned line when the model is offline or rambles', async () => {
    vi.mocked(claude).mockResolvedValueOnce(null);
    publish({ type: 'penalty', playerId: 'p1', reason: 'Missed deadline' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    vi.mocked(claude).mockResolvedValueOnce('word '.repeat(30));
    publish({ type: 'penalty', playerId: 'p1', reason: 'Again' });
    await vi.advanceTimersByTimeAsync(VOICE_WINDOW_MS);

    expect(voices).toHaveLength(2);
    voices.forEach((v) => expect(CANNED_LINES.penalty).toContain(v.text));
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
    expect(sanitizeLine('"**Rise, Player!**"\nsecond line')).toBe('Rise, Player.');
    expect(sanitizeLine('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen')).toBeNull();
    expect(sanitizeLine('   ')).toBeNull();
  });

  it('every canned line obeys the 15-word rule', () => {
    Object.values(CANNED_LINES).flat().forEach((line) => expect(sanitizeLine(line)).toBe(line));
  });
});
