'use client';
/** Holds a screen wake lock while `active`, re-requesting it whenever the page is visible again. */
import { useEffect, useRef } from 'react';
import { WakeLockKeeper, type WakeLockLike } from './screenGuard';

function requestScreenLock(): Promise<WakeLockLike | null> {
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return Promise.resolve(null);
  return navigator.wakeLock.request('screen');
}

export function useWakeLock(active: boolean): void {
  const keeper = useRef<WakeLockKeeper | null>(null);

  useEffect(() => {
    keeper.current ??= new WakeLockKeeper(requestScreenLock, () => document.visibilityState === 'visible');
    const current = keeper.current;
    void current.want(active);
    const onVisibility = (): void => void current.onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active]);

  useEffect(() => () => void keeper.current?.want(false), []);
}
