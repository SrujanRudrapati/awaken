import { describe, expect, it } from 'vitest';
import { ReadingSchema } from '../lib/schemas';
import {
  JAIL_DURATION_MS,
  PUSHUP_REP_MS,
  SQUAT_FULL_DEPTH_G,
  SQUAT_REP_MS,
  SQUAT_REST_G,
  parseMode,
  readingAt,
  squatDepth,
  waveform,
} from './simulator';

describe('simulator waveforms', () => {
  it('emits schema-valid readings for every mode', () => {
    for (const mode of ['pushup', 'squat', 'jail', 'idle'] as const) {
      for (const r of waveform(mode, 5_000)) {
        expect(ReadingSchema.parse(r)).toEqual(r);
      }
    }
  });

  it('samples every 100 ms with t in ms', () => {
    const w = waveform('idle', 1_000);
    expect(w).toHaveLength(10);
    expect(w.map((r) => r.t)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('push-up: Home Base pad pressed once per 1.5 s with one bounce sample on each edge', () => {
    const rep = waveform('pushup', PUSHUP_REP_MS).map((r) => r.pad);
    expect(rep).toEqual([0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0]);
    expect(waveform('pushup', 3 * PUSHUP_REP_MS).every((r) => r.source === 'homebase')).toBe(true);
  });

  it('squat: phone ay swings from −1 g to −0.2 g every 2 s; every 4th squat is half depth', () => {
    expect([1, 2, 3, 4, 5, 8].map(squatDepth)).toEqual([0.8, 0.8, 0.8, 0.4, 0.8, 0.4]);
    expect(readingAt('squat', 0)).toMatchObject({ source: 'phone', ay: SQUAT_REST_G });
    expect(readingAt('squat', SQUAT_REP_MS / 2).ay).toBeCloseTo(SQUAT_REST_G + SQUAT_FULL_DEPTH_G);
    expect(readingAt('squat', 3 * SQUAT_REP_MS + SQUAT_REP_MS / 2).ay).toBeCloseTo(SQUAT_REST_G + 0.4);
  });

  it('jail: 1 for 30 s then 0', () => {
    expect(readingAt('jail', 0).jail).toBe(1);
    expect(readingAt('jail', JAIL_DURATION_MS - 100).jail).toBe(1);
    expect(readingAt('jail', JAIL_DURATION_MS).jail).toBe(0);
    expect(readingAt('jail', JAIL_DURATION_MS + 60_000).jail).toBe(0);
  });

  it('idle: nothing moves', () => {
    const w = waveform('idle', 3_000);
    expect(new Set(w.map((r) => JSON.stringify({ ...r, t: 0 }))).size).toBe(1);
  });

  it('parseMode accepts known modes and rejects others', () => {
    expect(parseMode('squat')).toBe('squat');
    expect(parseMode(undefined)).toBe('idle');
    expect(() => parseMode('burpee')).toThrow(/pushup\|squat\|jail\|meditate\|lightsout\|idle/);
  });
});
