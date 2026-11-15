import { describe, expect, it } from 'vitest';
import type { Quest } from '../../lib/schemas';
import { pickPhoneQuest, upsertQuest } from './api';

const q = (over: Partial<Quest>): Quest => ({
  id: 'q', playerId: 'p', stat: 'STR', title: 't', type: 'squat', target: 10, progress: 0, xp: 30,
  status: 'active', deadline: '2030-01-01T00:00:00Z', ...over,
});

describe('hunter api helpers', () => {
  it('prefers a running emergency, skips non-phone and finished quests', () => {
    const quests = [
      q({ id: 'steps', type: 'steps' }),
      q({ id: 'done', status: 'done' }),
      q({ id: 'squat' }),
      q({ id: 'emerg', type: 'pushup', kind: 'emergency' }),
    ];
    expect(pickPhoneQuest(quests)?.id).toBe('emerg');
    expect(pickPhoneQuest(quests.slice(0, 3))?.id).toBe('squat');
    expect(pickPhoneQuest([q({ type: 'jail' })])).toBeNull();
  });

  it('upserts without mutating', () => {
    const list = [q({ id: 'a' })];
    const replaced = upsertQuest(list, q({ id: 'a', progress: 3 }));
    const added = upsertQuest(list, q({ id: 'b' }));

    expect(replaced[0].progress).toBe(3);
    expect(list[0].progress).toBe(0);
    expect(added.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
