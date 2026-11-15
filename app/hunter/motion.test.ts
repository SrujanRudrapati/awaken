import { describe, expect, it } from 'vitest';
import { ReadingSchema } from '../../lib/schemas';
import { MAX_BATCH, STANDARD_GRAVITY, shouldKeep, takeBatch, toReading } from './motion';

describe('phone motion helpers', () => {
  it('converts m/s² to a valid phone Reading in g', () => {
    const reading = toReading({ x: 0, y: -STANDARD_GRAVITY, z: 4.9 }, 1234.6);

    expect(reading).toEqual({ t: 1235, source: 'phone', ax: 0, ay: -1, az: 0.5 });
    expect(ReadingSchema.safeParse(reading).success).toBe(true);
  });

  it('drops empty samples (iOS sends nulls before permission settles)', () => {
    expect(toReading(null, 1)).toBeNull();
    expect(toReading({ x: null, y: 1, z: 1 }, 1)).toBeNull();
  });

  it('downsamples ~60 Hz events to ~30 Hz', () => {
    const kept: number[] = [];
    let last: number | null = null;
    for (let t = 0; t < 1000; t += 1000 / 60) {
      if (shouldKeep(last, t)) {
        kept.push(t);
        last = t;
      }
    }
    expect(kept.length).toBeGreaterThanOrEqual(29);
    expect(kept.length).toBeLessThanOrEqual(31);
  });

  it('batches at most MAX_BATCH and keeps only recent backlog', () => {
    const queue = Array.from({ length: 250 }, (_, i) => ({ t: i, source: 'phone' as const }));

    const { batch, rest } = takeBatch(queue);

    expect(batch).toHaveLength(MAX_BATCH);
    expect(batch[0].t).toBe(150); // oldest 150 dropped
    expect(rest).toHaveLength(MAX_BATCH);
  });
});
