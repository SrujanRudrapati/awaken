import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WakeLockKeeper, createLongPress, nextSensorPaused, type WakeLockLike } from './screenGuard';

function fakeLock(): WakeLockLike & { released: boolean; release: ReturnType<typeof vi.fn> } {
  const lock = {
    released: false,
    release: vi.fn(async () => {
      lock.released = true;
    }),
  };
  return lock;
}

describe('WakeLockKeeper', () => {
  it('requests a lock when a vow becomes active and releases it when it ends', async () => {
    const lock = fakeLock();
    const keeper = new WakeLockKeeper(async () => lock, () => true);

    await keeper.want(true);
    expect(keeper.held).toBe(true);

    await keeper.want(false);
    expect(lock.release).toHaveBeenCalledOnce();
    expect(keeper.held).toBe(false);
  });

  it('re-requests after the browser drops the lock (page hidden, then visible)', async () => {
    let visible = true;
    const locks: ReturnType<typeof fakeLock>[] = [];
    const keeper = new WakeLockKeeper(async () => {
      const lock = fakeLock();
      locks.push(lock);
      return lock;
    }, () => visible);
    await keeper.want(true);

    visible = false;
    locks[0].released = true; // the browser releases it on hide
    await keeper.onVisibilityChange();
    expect(locks).toHaveLength(1); // not while hidden
    visible = true;
    await keeper.onVisibilityChange();

    expect(locks).toHaveLength(2);
    expect(keeper.held).toBe(true);
  });

  it('does not re-request on visibility changes when no vow is active', async () => {
    const request = vi.fn(async () => fakeLock());
    const keeper = new WakeLockKeeper(request, () => true);

    await keeper.onVisibilityChange();

    expect(request).not.toHaveBeenCalled();
  });

  it('never holds two locks, and survives an unsupported API', async () => {
    const request = vi.fn(async () => fakeLock());
    const keeper = new WakeLockKeeper(request, () => true);
    await Promise.all([keeper.want(true), keeper.onVisibilityChange(), keeper.onVisibilityChange()]);
    expect(request).toHaveBeenCalledOnce();

    const failing = new WakeLockKeeper(async () => Promise.reject(new Error('NotAllowedError')), () => true);
    await expect(failing.want(true)).resolves.toBeUndefined();
    expect(failing.held).toBe(false);
  });

  it('releases a lock that arrives after the vow already ended', async () => {
    const lock = fakeLock();
    let resolve: (l: WakeLockLike) => void = () => undefined;
    const keeper = new WakeLockKeeper(() => new Promise((r) => (resolve = r)), () => true);

    const pending = keeper.want(true);
    await keeper.want(false);
    resolve(lock);
    await pending;

    expect(lock.release).toHaveBeenCalledOnce();
    expect(keeper.held).toBe(false);
  });
});

describe('createLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after holding for the full time', () => {
    const onFire = vi.fn();
    const press = createLongPress(2_000, onFire);

    press.down();
    vi.advanceTimersByTime(1_999);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onFire).toHaveBeenCalledOnce();
  });

  it('a tap or a short hold does nothing', () => {
    const onFire = vi.fn();
    const press = createLongPress(2_000, onFire);

    press.down();
    vi.advanceTimersByTime(300);
    press.up();
    press.down();
    vi.advanceTimersByTime(1_500);
    press.up();
    vi.advanceTimersByTime(5_000);

    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('nextSensorPaused', () => {
  it('raises the notice only when the page hides mid-vow while streaming', () => {
    expect(nextSensorPaused(false, { type: 'hidden', vowActive: true, streaming: true })).toBe(true);
    expect(nextSensorPaused(false, { type: 'hidden', vowActive: false, streaming: true })).toBe(false);
    expect(nextSensorPaused(false, { type: 'hidden', vowActive: true, streaming: false })).toBe(false);
  });

  it('a counted rep or a tap clears it; hiding again keeps it', () => {
    expect(nextSensorPaused(true, { type: 'rep' })).toBe(false);
    expect(nextSensorPaused(true, { type: 'dismiss' })).toBe(false);
    expect(nextSensorPaused(true, { type: 'hidden', vowActive: false, streaming: false })).toBe(true);
  });
});
