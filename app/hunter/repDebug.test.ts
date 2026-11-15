import { describe, expect, it } from 'vitest';
import { formatRepDebug, isDebugSearch, phoneExercise } from './repDebug';

describe('/hunter rep debug line', () => {
  it('turns on only for ?debug=1', () => {
    expect(isDebugSearch('?debug=1')).toBe(true);
    expect(isDebugSearch('?player=p1&debug=1')).toBe(true);
    expect(isDebugSearch('?debug=0')).toBe(false);
    expect(isDebugSearch('')).toBe(false);
  });

  it('maps vow types to the phone counter they use', () => {
    expect(phoneExercise('squat')).toBe('squat');
    expect(phoneExercise('pushup')).toBe('armPushup');
    expect(phoneExercise('jumpingjack')).toBe('jumpingjack');
    expect(phoneExercise('meditate')).toBeNull();
    expect(phoneExercise(undefined)).toBeNull();
  });

  it('shows depth as a share of the calibrated depth, rotation and the last server rejection', () => {
    const line = formatRepDebug({
      exercise: 'squat',
      snapshot: { calibrated: true, progress: 0.82, depth: 0.39, rotDps: 35.4 },
      serverReason: 'not deep enough',
    });

    expect(line).toBe('DBG squat · depth 82% of 0.39m · rot 35°/s · last ✕ not deep enough');
  });

  it('shows raw progress while calibrating, degrees for jacks, and n/a without a gyro', () => {
    expect(formatRepDebug({ exercise: 'jumpingjack', snapshot: { calibrated: false, progress: 42.6 }, serverReason: null })).toBe(
      'DBG jumpingjack · calibrating 42.60° · rot n/a · last ✕ —',
    );
    expect(formatRepDebug({ exercise: 'jumpingjack', snapshot: { calibrated: true, progress: 0.5, depth: 158.2 }, serverReason: null })).toBe(
      'DBG jumpingjack · depth 50% of 158° · rot n/a · last ✕ —',
    );
  });

  it('says so when no phone rep vow is focused', () => {
    expect(formatRepDebug({ exercise: null, snapshot: null, serverReason: 'too fast' })).toBe('DBG · no phone rep vow · last ✕ too fast');
  });
});
