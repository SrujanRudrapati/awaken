import { describe, expect, it } from 'vitest';
import { IrisMoodSchema, withMood } from './irisMood';

describe('irisMood on every SSE event', () => {
  it('derives the mood from the event; voice keeps its own', () => {
    expect(withMood({ type: 'levelup', playerId: 'p', fromRank: 'E', toRank: 'D', level: 3 }).irisMood).toBe('proud');
    expect(withMood({ type: 'penalty', playerId: 'p', reason: 'x' }).irisMood).toBe('furious');
    expect(withMood({ type: 'rep.rejected', playerId: 'p', questId: 'q', reason: 'too fast' }).irisMood).toBe('unimpressed');
    expect(withMood({ type: 'rep', playerId: 'p', questId: 'q', count: 1 }).irisMood).toBe('watching');
    expect(withMood({ type: 'voice', text: 'Zzz.', eventType: 'daily', irisMood: 'sleepy' }).irisMood).toBe('sleepy');
    expect(IrisMoodSchema.options).toEqual(['watching', 'unimpressed', 'proud', 'furious', 'sleepy']);
  });
});
