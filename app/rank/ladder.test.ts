import { describe, expect, test } from 'vitest';
import { zeroProof } from '../../lib/power';
import { boardWindow, dailyProof, rankProgress, rungState, statFraction } from './ladder';

describe('rankProgress', () => {
  test('starts at E with nothing proven', () => {
    expect(rankProgress({ proof: zeroProof() })).toEqual({ rank: 'E', power: 0, next: 'D', nextAt: 30, fraction: 0 });
  });

  test('treats a missing proof record as zero', () => {
    expect(rankProgress({}).rank).toBe('E');
  });

  test('measures progress through the current band', () => {
    const proof = { ...zeroProof(), STR: 400 }; // √400 = 20 Power, no balance bonus
    const progress = rankProgress({ proof });
    expect(progress.power).toBe(20);
    expect(progress.fraction).toBeCloseTo(20 / 30, 5);
  });

  test('is complete at A', () => {
    const proof = { STR: 2500, INT: 2500, FOCUS: 2500, VIT: 2500, DISCIPLINE: 2500, CHA: 2500 }; // 6×50 + 3×50
    expect(rankProgress({ proof })).toMatchObject({ rank: 'A', next: null, nextAt: null, fraction: 1 });
  });
});

describe('rungState', () => {
  test('marks letters below, at and above the current rank', () => {
    expect(rungState('E', 'C')).toBe('done');
    expect(rungState('C', 'C')).toBe('now');
    expect(rungState('A', 'C')).toBe('ahead');
  });
});

describe('dailyProof', () => {
  test('sums Proof per day and fills empty days with zero', () => {
    const days = dailyProof(
      [{ day: '2026-11-14', stat: 'STR', xp: 40 }, { day: '2026-11-14', stat: 'INT', xp: 10 }, { day: '2026-11-15', stat: 'STR', xp: 5 }],
      new Date(2026, 10, 15),
      3,
    );
    expect(days.map((d) => [d.day, d.proof])).toEqual([['2026-11-13', 0], ['2026-11-14', 50], ['2026-11-15', 5]]);
    expect(days[2].label).toBe('Sun');
  });
});

describe('statFraction', () => {
  test('uses a square-root scale and survives zero', () => {
    expect(statFraction(25, 100)).toBeCloseTo(0.5, 5);
    expect(statFraction(0, 0)).toBe(0);
  });
});

describe('boardWindow', () => {
  const members = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

  test('shows the top rows when the person is among them', () => {
    expect(boardWindow(members, 'b', 3).map((e) => e.member.id)).toEqual(['a', 'b', 'c']);
  });

  test('keeps the person on the board with their real position when they are lower', () => {
    expect(boardWindow(members, 'e', 3)).toEqual([{ position: 1, member: { id: 'a' } }, { position: 2, member: { id: 'b' } }, { position: 5, member: { id: 'e' } }]);
  });
});
