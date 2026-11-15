/**
 * Keeping /hunter alive in a pocket: a screen Wake Lock held while a vow is active (the browser
 * drops it whenever the page is hidden, so it is re-requested on return), and a long-press
 * controller for leaving Pocket mode. Browser APIs are injected so this is unit-tested.
 */

export interface WakeLockLike {
  readonly released: boolean;
  release(): Promise<void>;
}

/** Holds one screen wake lock while wanted; re-acquires when the page becomes visible again. */
export class WakeLockKeeper {
  private sentinel: WakeLockLike | null = null;
  private wanted = false;
  private pending = false;

  constructor(
    private readonly request: () => Promise<WakeLockLike | null>,
    private readonly isVisible: () => boolean,
  ) {}

  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async want(on: boolean): Promise<void> {
    this.wanted = on;
    if (on) await this.acquire();
    else await this.drop();
  }

  /** Call on every visibilitychange. */
  async onVisibilityChange(): Promise<void> {
    if (this.wanted && this.isVisible()) await this.acquire();
  }

  private async acquire(): Promise<void> {
    if (this.held || this.pending || !this.isVisible()) return;
    this.pending = true;
    try {
      const sentinel = await this.request();
      if (this.wanted) {
        this.sentinel = sentinel;
      } else {
        await sentinel?.release(); // turned off while the request was in flight
      }
    } catch {
      this.sentinel = null; // unsupported / denied (low battery): the page still works
    } finally {
      this.pending = false;
    }
  }

  private async drop(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel?.release().catch(() => undefined);
  }
}

/** Long press: `down()` starts a timer; `up()` before `ms` cancels; after `ms`, onFire runs once. */
export function createLongPress(
  ms: number,
  onFire: () => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, delay) => setTimeout(fn, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): { down: () => void; up: () => void } {
  let handle: unknown = null;
  const up = (): void => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const down = (): void => {
    up();
    handle = timers.set(() => {
      handle = null;
      onFire();
    }, ms);
  };
  return { down, up };
}

/** What can change the "Sensor paused — screen was locked" notice. */
export type SensorPauseEvent =
  | { type: 'hidden'; vowActive: boolean; streaming: boolean }
  | { type: 'rep' }
  | { type: 'dismiss' };

/**
 * iOS stops motion events while the page is hidden (screen locked, app switched), so reps in
 * that time are lost. Raise the notice if that happened mid-vow; a counted rep or a tap clears it.
 */
export function nextSensorPaused(paused: boolean, event: SensorPauseEvent): boolean {
  switch (event.type) {
    case 'hidden':
      return paused || (event.vowActive && event.streaming);
    case 'rep':
    case 'dismiss':
      return false;
  }
}
