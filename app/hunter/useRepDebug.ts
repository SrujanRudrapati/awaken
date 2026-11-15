'use client';
/**
 * Mirrors the server's rep verifier on this phone for the ?debug=1 line: feed it every reading
 * the sender keeps; it repaints at most every PAINT_MS. Off (no work at all) unless enabled.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccelExercise } from '../../engine/verifiers/accelReps';
import { createRepCounter, type RepCounter } from '../../engine/verifiers/repCounter';
import type { RepDebug } from '../../engine/verifiers/repDebug';
import type { Reading } from '../../lib/schemas';

const PAINT_MS = 200;

export function useRepDebug(exercise: AccelExercise | null, enabled: boolean): { snapshot: RepDebug | null; onReading: (reading: Reading) => void } {
  const counter = useRef<RepCounter | null>(null);
  const lastPaint = useRef<number | null>(null);
  const [painted, setPainted] = useState<{ exercise: AccelExercise; state: RepDebug } | null>(null);

  useEffect(() => {
    counter.current = enabled && exercise ? createRepCounter(exercise) : null;
    lastPaint.current = null;
  }, [enabled, exercise]);

  const onReading = useCallback(
    (reading: Reading) => {
      const current = counter.current;
      if (!current || !exercise) return;
      current.push(reading);
      const last = lastPaint.current;
      if (last !== null && reading.t >= last && reading.t - last < PAINT_MS) return;
      lastPaint.current = reading.t;
      setPainted({ exercise, state: current.debugState });
    },
    [exercise],
  );

  const snapshot = enabled && painted && painted.exercise === exercise ? painted.state : null;
  return { snapshot, onReading };
}
