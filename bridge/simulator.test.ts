import { describe, expect, it } from 'vitest';
import { ReadingSchema } from '../lib/schemas';
import {
  JAIL_DURATION_MS,
  PUSHUP_FULL_CM,
  PUSHUP_REP_MS,
  PUSHUP_SHALLOW_CM,
  PUSHUP_TOP_CM,
  SQUAT_PEAK_G,
  SQUAT_REP_MS,
  parseMode,
  pushupBottom,
  readingAt,
  waveform,
} from './simulator';

describe('simulator waveforms', () => {
  it('emits schema-valid readings for every mode', () => {
    for (const mode of ['pushup', 'squat', 'jail', 'idle'] as const) {
      for (const r of waveform(mode, 5_000)) {
        expect(ReadingSchema.safeParse(r).success).toBe(true);
      }
    }
  });

  it('samples every 100 ms with t in ms', () => {
    const w = waveform('idle', 1_000);
    expect(w).toHaveLength(10);
    expect(w.map((r) => r.t)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('push-up: 40 → 10 → 40 cm over 1.5 s', () => {
    expect(readingAt('pushup', 0).dist).toBeCloseTo(PUSHUP_TOP_CM);
    expect(readingAt('pushup', PUSHUP_REP_MS / 2).dist).toBeCloseTo(PUSHUP_FULL_CM);
    expect(readingAt('pushup', PUSHUP_REP_MS).dist).toBeCloseTo(PUSHUP_TOP_CM);
  });

  it('push-up: every 4th rep only reaches 22 cm', () => {
    expect([1, 2, 3, 4, 5, 8, 12].map(pushupBottom)).toEqual([10, 10, 10, 22, 10, 22, 22]);
    const rep4Bottom = 3 * PUSHUP_REP_MS + PUSHUP_REP_MS / 2;
    expect(readingAt('pushup', rep4Bottom).dist).toBeCloseTo(PUSHUP_SHALLOW_CM);
  });

  it('push-up: 10 reps = 8 full + 2 shallow minima', () => {
    const w = waveform('pushup', 10 * PUSHUP_REP_MS);
    const minima = Array.from({ length: 10 }, (_, i) =>
      Math.min(...w.slice(i * 15, (i + 1) * 15).map((r) => r.dist)),
    );
    expect(minima.filter((d) => d <= PUSHUP_FULL_CM + 0.5)).toHaveLength(8);
    expect(minima.filter((d) => Math.abs(d - PUSHUP_SHALLOW_CM) < 0.5)).toHaveLength(2);
  });

  it('squat: az peaks ~1.8 g once every 2 s, resting at 1 g', () => {
    expect(readingAt('squat', 0).az).toBeCloseTo(1, 1);
    expect(readingAt('squat', SQUAT_REP_MS / 2).az).toBeCloseTo(SQUAT_PEAK_G, 2);
    const w = waveform('squat', 3 * SQUAT_REP_MS);
    const peaks = w.filter((r, i) => r.az > 1.4 && (i === 0 || w[i - 1].az <= 1.4));
    expect(peaks).toHaveLength(3);
  });

  it('jail: 1 for 30 s then 0', () => {
    expect(readingAt('jail', 0).jail).toBe(1);
    expect(readingAt('jail', JAIL_DURATION_MS - 100).jail).toBe(1);
    expect(readingAt('jail', JAIL_DURATION_MS).jail).toBe(0);
    expect(readingAt('jail', JAIL_DURATION_MS + 60_000).jail).toBe(0);
  });

  it('idle: nothing moves', () => {
    const w = waveform('idle', 3_000);
    expect(new Set(w.map((r) => `${r.dist},${r.az},${r.jail}`)).size).toBe(1);
  });

  it('parseMode accepts known modes and rejects others', () => {
    expect(parseMode('squat')).toBe('squat');
    expect(parseMode(undefined)).toBe('idle');
    expect(() => parseMode('burpee')).toThrow(/pushup\|squat\|jail\|idle/);
  });
});
