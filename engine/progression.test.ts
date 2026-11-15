import { describe, expect, it } from 'vitest';
import { QuestTypeSchema } from '../lib/schemas';
import { QUEST_RULES, demoRankUpXp, endOfDay, levelForXp, rankForXp, rankSegment, segNumber, xpFor } from './progression';

describe('progression', () => {
  it.each([[0, 100], [40, 60], [100, 200], [2999, 1], [3000, 0]])('xp %i → %i XP to the next rank', (xp, need) => {
    expect(demoRankUpXp(xp)).toBe(need);
  });

  it.each([
    [0, 'E'], [99, 'E'], [100, 'D'], [299, 'D'], [300, 'C'], [700, 'B'], [1499, 'B'], [1500, 'A'], [3000, 'S'], [99999, 'S'],
  ] as const)('xp %i → rank %s', (xp, rank) => {
    expect(rankForXp(xp)).toBe(rank);
  });

  it.each([[0, 1], [49, 1], [50, 2], [149, 3], [1000, 21]])('xp %i → level %i', (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });

  it('scales XP by difficulty', () => {
    expect([xpFor('pushup', 'easy'), xpFor('pushup', 'normal'), xpFor('pushup', 'hard')]).toEqual([20, 30, 40]);
  });

  it('has a rule for every quest type', () => {
    expect(Object.keys(QUEST_RULES).sort()).toEqual([...QuestTypeSchema.options].sort());
  });

  it('formats 4-char display commands', () => {
    expect(segNumber(7)).toBe('SEG:   7');
    expect(segNumber(30)).toBe('SEG:  30');
    expect(segNumber(123456)).toBe('SEG:9999');
    expect(segNumber(-3)).toBe('SEG:   0');
    expect(rankSegment('B')).toBe('SEG:RK-B');
  });

  it('endOfDay is 23:59:59.999 local on the same day', () => {
    const end = endOfDay(new Date(2026, 10, 14, 9, 30));
    expect([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([14, 23, 59, 59]);
  });
});
