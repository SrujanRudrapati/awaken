import { describe, expect, it } from 'vitest';
import { ReadingSchema } from '../../lib/schemas';
import { MAX_BATCH, STANDARD_GRAVITY, shouldKeep, takeBatch, toReading } from './motion';

describe('phone motion helpers', () => {
  it('converts m/s² to a valid phone Reading in g', () => {
    const reading = toReading({ x: 0, y: -STANDARD_GRAVITY, z: 4.9 }, 1234.6);

    expect(reading).toEqual({ t: 1235, source: 'phone', ax: 0, ay: -1, az: 0.5 });
    expect(ReadingSchema.safeParse(reading).success).toBe(true);
  });

  it('adds rotationRate as rx/ry/rz in deg/s (beta → x, gamma → y, alpha → z)', () => {
    const reading = toReading({ x: 0, y: -STANDARD_GRAVITY, z: 0 }, 10, { alpha: 30.04, beta: -120.26, gamma: 5 });

    expect(reading).toEqual({ t: 10, source: 'phone', ax: 0, ay: -1, az: 0, rx: -120.3, ry: 5, rz: 30 });
    expect(ReadingSchema.safeParse(reading).success).toBe(true);
  });

  it('leaves rotation out when the browser has no gyro data', () => {
    expect(toReading({ x: 0, y: -STANDARD_GRAVITY, z: 0 }, 10, { alpha: null, beta: null, gamma: null })).toEqual({
      t: 10, source: 'phone', ax: 0, ay: -1, az: 0,
    });
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

describe('readingsUrl', () => {
  it("tags the phone's readings with the focused vow's session", async () => {
    const { readingsUrl } = await import('./motion');
    expect(readingsUrl('ab12cd34')).toBe('/api/readings?sessionId=ab12cd34');
  });

  it('without a session there is nothing to count toward (readings still feed the live view)', async () => {
    const { readingsUrl } = await import('./motion');
    expect(readingsUrl(undefined)).toBe('/api/readings');
  });
});
