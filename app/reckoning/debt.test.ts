import { describe, expect, test } from 'vitest';
import type { Quest } from '../../lib/schemas';
import { countdown, reckoningVow } from './debt';

const vow = (over: Partial<Quest>): Quest => ({
  id: 'q', playerId: 'ada', stat: 'STR', title: 'Thirty squats', type: 'squat', target: 30, progress: 0, xp: 0,
  status: 'active', deadline: '2026-11-16T06:59:59.999Z', kind: 'penalty', ...over,
});

describe('reckoningVow', () => {
  test('picks the active Reckoning vow that runs out first', () => {
    const picked = reckoningVow([vow({ id: 'late', deadline: '2026-11-17T00:00:00.000Z' }), vow({ id: 'soon' }), vow({ id: 'daily', kind: 'daily' })]);
    expect(picked?.id).toBe('soon');
  });

  test('is null when nothing is owed', () => {
    expect(reckoningVow([vow({ status: 'done' }), vow({ kind: 'daily' })])).toBeNull();
  });
});

describe('countdown', () => {
  test('formats hours, minutes and seconds', () => {
    expect(countdown('2026-11-15T12:00:00.000Z', Date.parse('2026-11-15T10:00:18.000Z'))).toBe('01:59:42');
  });

  test('stops at zero', () => {
    expect(countdown('2026-11-15T12:00:00.000Z', Date.parse('2026-11-15T13:00:00.000Z'))).toBe('00:00:00');
  });
});
