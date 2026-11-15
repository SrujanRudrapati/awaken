import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/llm', () => ({ geminiJson: vi.fn() }));
vi.mock('../../lib/memory', () => ({ recall: vi.fn(async () => 'Goal: pass calc') }));

import { geminiJson } from '../../lib/llm';
import type { Player } from '../../lib/schemas';
import { DAILY_TEMPLATES } from '../progression';
import { createGeminiDesigner, recallForDesigner, validateDesign } from './designer';

const player: Player = {
  id: 'p1', name: 'Jin', rank: 'E', level: 1, xp: 0, penalty: false,
  stats: { STR: 3, INT: 0, FOCUS: 0, VIT: 1, DISCIPLINE: 0, CHA: 0 },
};

describe('quest designer', () => {
  it('keeps only known, designable, unique types', () => {
    const result = validateDesign({
      quests: [
        { type: 'squat', difficulty: 'easy' },
        { type: 'squat', difficulty: 'hard' }, // duplicate
        { type: 'yoga', difficulty: 'normal' }, // unknown
        { type: 'gate', difficulty: 'normal' }, // not designable
        { type: 'jail', difficulty: 'brutal' }, // bad difficulty
        { type: 'meditate', difficulty: 'normal' },
        { type: 'steps', difficulty: 'hard' },
      ],
    });
    expect(result).toEqual([
      { type: 'squat', difficulty: 'easy' },
      { type: 'meditate', difficulty: 'normal' },
      { type: 'steps', difficulty: 'hard' },
    ]);
  });

  it('too few valid quests → null (caller uses templates)', () => {
    expect(validateDesign({ quests: [{ type: 'squat', difficulty: 'easy' }] })).toBeNull();
    expect(validateDesign(null)).toBeNull();
  });

  it('falls back to DAILY_TEMPLATES when Gemini is offline, and passes memory context', async () => {
    vi.mocked(geminiJson).mockResolvedValue(null);
    const design = createGeminiDesigner({ context: async () => 'Goal: run a 5k' });

    expect(await design(player)).toBe(DAILY_TEMPLATES);
    expect(vi.mocked(geminiJson).mock.calls[0][0].prompt).toContain('Goal: run a 5k');
  });

  it('recallForDesigner asks Supermemory about this player', async () => {
    vi.mocked(geminiJson).mockResolvedValue(null);
    await createGeminiDesigner({ context: recallForDesigner })(player);
    expect(vi.mocked(geminiJson).mock.calls.at(-1)![0].prompt).toContain('Goal: pass calc');
  });
});
