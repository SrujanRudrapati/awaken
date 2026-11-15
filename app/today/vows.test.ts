import { describe, expect, test } from 'vitest';
import type { Quest } from '../../lib/schemas';
import { clock, fraction, groupVows, hoursMinutes, progressLabel, vowAction, vowTone } from './vows';

const vow = (over: Partial<Quest>): Quest => ({
  id: 'q', playerId: 'ada', stat: 'STR', title: 'Push-ups', type: 'pushup', target: 20, progress: 0, xp: 30,
  status: 'active', deadline: '2026-11-16T06:59:59.999Z', kind: 'daily', ...over,
});

describe('groupVows', () => {
  test('orders urgent, Reckoning, today, sworn, kept and hides Calibration', () => {
    const groups = groupVows([
      vow({ id: 'kept', status: 'done' }),
      vow({ id: 'cal', kind: 'calibration' }),
      vow({ id: 'mine', kind: 'manual' }),
      vow({ id: 'daily' }),
      vow({ id: 'pen', kind: 'penalty' }),
      vow({ id: 'now', kind: 'emergency' }),
      vow({ id: 'gone', status: 'cancelled' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'reckoning', 'today', 'sworn', 'kept']);
    expect(groups.flatMap((g) => g.vows.map((v) => v.id))).toEqual(['now', 'pen', 'daily', 'mine', 'kept']);
  });

  test('returns nothing when there are no vows', () => {
    expect(groupVows([])).toEqual([]);
  });
});

describe('progressLabel', () => {
  test('counts reps with their unit', () => {
    expect(progressLabel(vow({ type: 'squat', progress: 3, target: 25 }))).toBe('3 / 25 squats');
  });

  test('shows timed vows as clocks', () => {
    expect(progressLabel(vow({ type: 'jail', progress: 20, target: 300 }))).toBe('0:20 / 5:00');
  });

  test('shows the bedtime for sleep-clock vows', () => {
    expect(progressLabel(vow({ type: 'lightsoutby', targetTime: '23:30', target: 1 }))).toBe('Asleep by 23:30');
  });
});

describe('vowAction', () => {
  test('sensor vows can only be begun', () => {
    expect(vowAction(vow({ type: 'pushup' }))).toBe('begin');
  });

  test('a read vow asks for its trial once the time is served', () => {
    expect(vowAction(vow({ type: 'read', progress: 10, target: 20 }))).toBe('begin');
    expect(vowAction(vow({ type: 'read', progress: 20, target: 20 }))).toBe('readTrial');
  });

  test('photo and Field Vows ask for a photo; Health vows have no button', () => {
    expect(vowAction(vow({ type: 'gate' }))).toBe('photo');
    expect(vowAction(vow({ type: 'steps' }))).toBe('none');
  });

  test('finished vows have no action', () => {
    expect(vowAction(vow({ status: 'done' }))).toBe('none');
  });
});

describe('formatting', () => {
  test('clock pads seconds', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(-3)).toBe('0:00');
  });

  test('fraction is clamped and full once kept', () => {
    expect(fraction(vow({ progress: 30, target: 20 }))).toBe(1);
    expect(fraction(vow({ status: 'done', progress: 0 }))).toBe(1);
  });

  test('tone is red for urgent and gold for kept', () => {
    expect(vowTone(vow({ kind: 'emergency' }))).toBe('red');
    expect(vowTone(vow({ status: 'done' }))).toBe('gold');
    expect(vowTone(vow({}))).toBeUndefined();
  });

  test('hoursMinutes splits minutes', () => {
    expect(hoursMinutes(433)).toBe('7 h 13 m');
  });
});
