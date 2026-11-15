import { describe, expect, test } from 'vitest';
import type { FocusTrial } from '../../components/oath/api';
import { recordTap, secondsLeft, stimulusAt, toResponses } from './focus';

const trials: FocusTrial[] = [{ i: 0, atMs: 1500, kind: 'go' }, { i: 1, atMs: 2800, kind: 'nogo' }, { i: 2, atMs: 4100, kind: 'go' }];

describe('stimulusAt', () => {
  test('shows a stimulus for one second from its time', () => {
    expect(stimulusAt(trials, 1499)).toBeNull();
    expect(stimulusAt(trials, 1500)?.i).toBe(0);
    expect(stimulusAt(trials, 2499)?.i).toBe(0);
    expect(stimulusAt(trials, 2500)).toBeNull();
  });
});

describe('recordTap', () => {
  test('records the reaction time from stimulus to tap', () => {
    expect(recordTap({}, trials, 1812)).toEqual({ 0: 312 });
  });

  test('keeps only the first tap on a stimulus', () => {
    expect(recordTap({ 0: 312 }, trials, 2000)).toEqual({ 0: 312 });
  });

  test('ignores taps between stimuli', () => {
    expect(recordTap({}, trials, 500)).toEqual({});
  });
});

describe('toResponses', () => {
  test('answers every trial, null where nothing was tapped', () => {
    expect(toResponses(trials, { 0: 312, 2: 280 })).toEqual([{ i: 0, rtMs: 312 }, { i: 1, rtMs: null }, { i: 2, rtMs: 280 }]);
  });
});

describe('secondsLeft', () => {
  test('rounds up and never goes negative', () => {
    const now = Date.parse('2026-11-15T10:00:00.000Z');
    expect(secondsLeft('2026-11-15T10:00:59.200Z', now)).toBe(60);
    expect(secondsLeft('2026-11-15T09:00:00.000Z', now)).toBe(0);
  });
});
