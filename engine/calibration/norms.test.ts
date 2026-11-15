import { describe, expect, it } from 'vitest';
import { buildTrials, scoreTrials } from './focus';
import { adapt, nextQuestion, validatePool } from './mind';
import { ageGroup, bodyScore, focusScore, mindScore, scoreAgainst, startingRank, startingStats, vitalityScore } from './norms';

describe('Calibration scoring', () => {
  it('maps norm anchors to 20/50/90 and clamps', () => {
    expect(scoreAgainst(28, [12, 28, 50])).toBe(50);
    expect(scoreAgainst(12, [12, 28, 50])).toBe(20);
    expect(scoreAgainst(50, [12, 28, 50])).toBe(90);
    expect(scoreAgainst(0, [12, 28, 50])).toBe(0);
    expect(scoreAgainst(500, [12, 28, 50])).toBe(100);
  });

  it('age groups shift the norms (same reps score higher when older)', () => {
    expect(ageGroup(undefined)).toBe('30s');
    expect(bodyScore(20, 'pushup', 25)).toBeLessThan(bodyScore(20, 'pushup', 55));
    expect(bodyScore(30, 'wallpushup', 30)).toBeLessThan(bodyScore(30, 'pushup', 30)); // wall push-ups are easier
  });

  it('vitality blends Health steps and sleep only when present', () => {
    const jacksOnly = vitalityScore({ jumpingJacks: 45 }, 35);
    expect(jacksOnly).toBe(50);
    expect(vitalityScore({ jumpingJacks: 45, avgSteps: 11_000, avgSleepHours: 8 }, 35)).toBeGreaterThan(jacksOnly);
  });

  it('mind rewards harder correct answers; focus rewards accuracy and speed', () => {
    expect(mindScore([{ level: 3, correct: true }, { level: 3, correct: true }, { level: 3, correct: true }])).toBe(100);
    expect(mindScore([{ level: 1, correct: true }])).toBe(11); // < 3 answered scales down
    const sharp = focusScore({ hits: 30, misses: 0, falseAlarms: 0, correctRejections: 10, meanRtMs: 300 });
    const sloppy = focusScore({ hits: 20, misses: 10, falseAlarms: 6, correctRejections: 4, meanRtMs: 550 });
    expect(sharp).toBe(100);
    expect(sloppy).toBeLessThan(50);
  });

  it('starting rank is capped at C; Discipline and Presence start at 0', () => {
    expect(startingRank({ body: 100, vitality: 100, mind: 100, focus: 100 })).toBe('C');
    expect(startingRank({ body: 50, vitality: 50, mind: 40, focus: 50 })).toBe('D');
    expect(startingRank({ body: 10, vitality: 20, mind: 30, focus: 20 })).toBe('E');
    expect(startingStats({ body: 90, vitality: 50, mind: 70, focus: 30 })).toEqual({ STR: 5, VIT: 3, INT: 4, FOCUS: 2, DISCIPLINE: 0, CHA: 0 });
  });
});

describe('Calibration · Focus go/no-go', () => {
  it('builds ~45 trials in 60 s with at least 8 no-go', () => {
    const trials = buildTrials(() => 0.5);
    expect(trials.length).toBeGreaterThan(40);
    expect(trials.filter((t) => t.kind === 'nogo').length).toBeGreaterThanOrEqual(8);
    expect(trials.at(-1)!.atMs).toBeLessThan(60_000);
  });

  it('scores taps: guesses < 120 ms and late taps miss; taps on no-go are false alarms', () => {
    const trials = [
      { i: 0, atMs: 0, kind: 'go' as const },
      { i: 1, atMs: 0, kind: 'go' as const },
      { i: 2, atMs: 0, kind: 'go' as const },
      { i: 3, atMs: 0, kind: 'nogo' as const },
      { i: 4, atMs: 0, kind: 'nogo' as const },
    ];
    const result = scoreTrials(trials, [{ i: 0, rtMs: 320 }, { i: 1, rtMs: 60 }, { i: 3, rtMs: 400 }, { i: 99, rtMs: 300 }]);
    expect(result).toEqual({ hits: 1, misses: 2, falseAlarms: 1, correctRejections: 1, meanRtMs: 320 });
  });
});

describe('Calibration · Mind adaptive quiz', () => {
  it('a pool needs ≥ 3 valid questions per level', () => {
    const q = (level: number) => ({ question: `Question at ${level}?`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, level });
    expect(validatePool([q(1), q(1), q(1), q(2), q(2), q(2), q(3), q(3), q(3)])).toHaveLength(9);
    expect(validatePool([q(1), q(2), q(3)])).toBeNull();
  });

  it('correct → harder, wrong → easier, falling back to the nearest level', () => {
    expect(adapt(2, true)).toBe(3);
    expect(adapt(1, false)).toBe(1);
    const pool = [{ id: 'a', level: 1 as const, question: 'q', options: ['1', '2', '3', '4'], answerIndex: 0 }];
    expect(nextQuestion(pool, new Set(), 3)?.id).toBe('a');
    expect(nextQuestion(pool, new Set(['a']), 3)).toBeNull();
  });
});
