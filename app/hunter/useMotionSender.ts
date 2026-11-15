'use client';
/**
 * Streams the phone's accelerometer to POST /api/readings (source 'phone'): ~30 Hz samples,
 * one batch every 200 ms, tagged with the focused vow's sessionId (untagged readings count toward nothing).
 * start() must run inside a tap — iOS only grants motion access then.
 * The screen wake lock lives in useWakeLock (held while a vow is active or the sensor streams).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reading } from '../../lib/schemas';
import { FLUSH_INTERVAL_MS, readingsUrl, shouldKeep, takeBatch, toReading } from './motion';

export type MotionStatus = 'idle' | 'requesting' | 'streaming' | 'denied' | 'unsupported' | 'offline';

type PermissionFn = () => Promise<'granted' | 'denied'>;

async function requestMotionPermission(): Promise<boolean> {
  const ctor = typeof DeviceMotionEvent === 'undefined' ? undefined : DeviceMotionEvent;
  if (!ctor) return false;
  const request = (ctor as unknown as { requestPermission?: PermissionFn }).requestPermission;
  if (typeof request !== 'function') return true; // Android / desktop: no prompt
  try {
    return (await request()) === 'granted';
  } catch {
    return false;
  }
}

export function useMotionSender(
  sessionId: string | undefined,
  onReading?: (reading: Reading) => void,
): { status: MotionStatus; sent: number; start: () => Promise<void>; stop: () => void } {
  const [status, setStatus] = useState<MotionStatus>('idle');
  const session = useRef(sessionId);
  const tap = useRef(onReading);
  useEffect(() => {
    session.current = sessionId;
    tap.current = onReading;
  }, [sessionId, onReading]);
  const [sent, setSent] = useState(0);
  const queue = useRef<Reading[]>([]);
  const lastKept = useRef<number | null>(null);
  const cleanup = useRef<() => void>(() => {});

  const flush = useCallback(async () => {
    const { batch, rest } = takeBatch(queue.current);
    if (batch.length === 0) return;
    queue.current = rest;
    try {
      const res = await fetch(readingsUrl(session.current), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
      });
      setStatus(res.ok ? 'streaming' : 'offline');
      if (res.ok) setSent((n) => n + batch.length);
    } catch {
      setStatus('offline'); // keep sampling; the next flush retries with fresh data
    }
  }, []);

  const stop = useCallback(() => {
    cleanup.current();
    cleanup.current = () => {};
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    setStatus('requesting');
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setStatus('unsupported');
      return;
    }
    if (!(await requestMotionPermission())) {
      setStatus('denied');
      return;
    }
    const onMotion = (event: DeviceMotionEvent): void => {
      const now = performance.now();
      if (!shouldKeep(lastKept.current, now)) return;
      const reading = toReading(event.accelerationIncludingGravity, now, event.rotationRate);
      if (!reading) return;
      lastKept.current = now;
      queue.current = [...queue.current, reading];
      tap.current?.(reading);
    };
    window.addEventListener('devicemotion', onMotion);
    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    cleanup.current = () => {
      window.removeEventListener('devicemotion', onMotion);
      clearInterval(timer);
      queue.current = [];
    };
    setStatus('streaming');
  }, [flush]);

  useEffect(() => () => cleanup.current(), []);

  return { status, sent, start, stop };
}
