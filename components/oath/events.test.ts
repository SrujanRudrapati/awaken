import { describe, expect, test } from 'vitest';
import type { Quest, StreamEvent } from '../../lib/schemas';
import { announcementFor, eventPersonId, isForPerson, plainTitle, rejectionLine } from './events';

const quest: Quest = {
  id: 'q1', playerId: 'ada', stat: 'STR', title: 'Push-ups', type: 'pushup', target: 10, progress: 0, xp: 20,
  status: 'active', deadline: '2026-11-16T06:59:59.999Z',
};

describe('eventPersonId', () => {
  test('reads the owner from the vow on quest events', () => {
    const event: StreamEvent = { type: 'quest.update', quest };
    expect(eventPersonId(event)).toBe('ada');
  });

  test('reads playerId on rep events', () => {
    expect(eventPersonId({ type: 'rep', playerId: 'bo', questId: 'q1', count: 3 })).toBe('bo');
  });

  test('is undefined for a broadcast voice line', () => {
    expect(eventPersonId({ type: 'voice', text: 'Go on.', eventType: 'daily' })).toBeUndefined();
  });
});

describe('isForPerson', () => {
  test('accepts own events and broadcasts, rejects other people', () => {
    expect(isForPerson({ type: 'rep', playerId: 'ada', questId: 'q1', count: 1 }, 'ada')).toBe(true);
    expect(isForPerson({ type: 'voice', text: 'Hi', eventType: 'daily' }, 'ada')).toBe(true);
    expect(isForPerson({ type: 'rep', playerId: 'bo', questId: 'q1', count: 1 }, 'ada')).toBe(false);
  });
});

describe('rejectionLine', () => {
  test('tells the person to go deeper on a shallow rep', () => {
    expect(rejectionLine('not deep enough')).toBe('Not counted — go deeper');
  });

  test('passes other reasons through in lower case without the full stop', () => {
    expect(rejectionLine('Too fast.')).toBe('Not counted — too fast');
  });
});

describe('announcementFor', () => {
  test('announces a kept vow with its Proof', () => {
    expect(announcementFor({ type: 'quest.complete', quest, xpGained: 20 })).toEqual({ tone: 'blue', header: 'Vow kept', title: 'Push-ups', detail: '+20 Proof' });
  });

  test('announces a new rank letter in gold', () => {
    expect(announcementFor({ type: 'rank.up', playerId: 'ada', fromRank: 'E', toRank: 'D', power: 31 })).toMatchObject({ tone: 'gold', title: 'Rank D' });
  });

  test('announces the Reckoning in red with the reason', () => {
    expect(announcementFor({ type: 'penalty', playerId: 'ada', reason: 'Missed a day.' })).toMatchObject({ tone: 'red', header: 'The Reckoning', detail: 'Missed a day.' });
  });

  test('stays quiet for ordinary events', () => {
    expect(announcementFor({ type: 'rep', playerId: 'ada', questId: 'q1', count: 1 })).toBeNull();
  });
});

describe('plainTitle', () => {
  test('drops a leading tag and keeps untagged titles', () => {
    expect(plainTitle('[RECKONING] Mind Trial')).toBe('Mind Trial');
    expect(plainTitle('Make your bed')).toBe('Make your bed');
  });
});
