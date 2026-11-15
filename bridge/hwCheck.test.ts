import { describe, expect, it } from 'vitest';
import { SENSORS, createHwState, ingest, render, statusOf } from './hwCheck';

const spec = (key: string) => SENSORS.find((s) => s.key === key)!;
const line = (over: Record<string, unknown>) =>
  JSON.stringify({ t: 100, pad: 0, btn: 0, light: 750, snd: 500, ax: 0.98, ay: -0.42, az: -0.23, jail: null, servo: null, ...over });

describe('hw:check tracker', () => {
  it('marks a sensor ✓ only after it visibly responds', () => {
    const state = createHwState();
    ingest(state, line({}));
    expect(statusOf(state, spec('pad'))).toBe('idle');

    ingest(state, line({ pad: 1 }));
    ingest(state, line({ light: 40 }));
    expect(statusOf(state, spec('pad'))).toBe('ok');
    expect(statusOf(state, spec('light'))).toBe('ok');
    expect(statusOf(state, spec('btn'))).toBe('idle');
  });

  it('reports null hardware as absent, and keeps boot/ack lines', () => {
    const state = createHwState();
    ingest(state, '{"boot":"homebase","fw":"oath-1","accel":true,"display":true}');
    ingest(state, '{"ack":"LOCK","ok":false}');
    ingest(state, line({}));
    ingest(state, 'garbage');

    expect(statusOf(state, spec('jail'))).toBe('absent');
    expect(statusOf(state, spec('servo'))).toBe('absent');
    const text = render(state);
    expect(text).toContain('"fw":"oath-1"');
    expect(text).toContain('LOCK → FAILED');
    expect(text).toMatch(/Accel MMA7660.*\|g\| 1\.09/);
  });

  it('shows "waiting" before any reading arrives', () => {
    expect(statusOf(createHwState(), spec('snd'))).toBe('waiting');
  });
});
