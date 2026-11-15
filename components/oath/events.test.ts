import { describe, expect, test } from 'vitest';
import type { Quest, StreamEvent } from '../../lib/schemas';
import { eventPersonId, isForPerson, rejectionLine } from './events';

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
