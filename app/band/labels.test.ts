import { describe, expect, test } from 'vitest';
import { containsBannedWord } from '../../lib/brand';
import { SENSOR_STATUS, VOW_CARDS, clockLeft, padCount, vowKicker, vowUnit } from './labels';

describe('band labels', () => {
  test('pads the rep counter to two digits', () => {
    expect(padCount(0)).toBe('00');
    expect(padCount(7)).toBe('07');
    expect(padCount(123)).toBe('123');
  });

  test('formats the time left and stops at zero', () => {
    const now = Date.parse('2026-11-15T10:00:00.000Z');
    expect(clockLeft('2026-11-15T10:00:27.000Z', now)).toBe('0:27');
    expect(clockLeft('2026-11-15T10:01:05.000Z', now)).toBe('1:05');
    expect(clockLeft('2026-11-15T09:59:00.000Z', now)).toBe('0:00');
  });

  test('names the vow by kind and stat', () => {
    expect(vowKicker({ kind: 'emergency', stat: 'STR' })).toBe('Urgent vow · Body');
    expect(vowKicker({ kind: 'penalty', stat: 'VIT' })).toBe('Reckoning vow · Vitality');
    expect(vowKicker({ kind: undefined, stat: 'STR' })).toBe('Vow · Body');
  });

  test('falls back to reps for vows the phone cannot name', () => {
    expect(vowUnit('pushup')).toBe('push-ups');
    expect(vowUnit('punch')).toBe('reps');
  });

  test('never shows a word from the old brand', () => {
    const words = [...Object.values(SENSOR_STATUS), ...VOW_CARDS.flatMap((c) => [c.name, c.unit, c.stat])];
    expect(words.filter(containsBannedWord)).toEqual([]);
  });
});
