/**
 * Ordered, coalescing writes per key. DB saves here are full-row upserts fired without waiting;
 * on a pooled connection two of them can finish in either order and leave an older row stored.
 * This keeps at most one write per key in flight; values arriving meanwhile replace each other,
 * and only the newest is written next — so the last write to land is always the latest value.
 */
export type LatestWriter<T> = (key: string, value: T) => void;

interface Queue {
  inFlight: Set<string>;
  pending: Map<string, unknown>;
}

/** Queues live on globalThis: Next bundles each route separately, and they must share one queue per name. */
const globalForWriters = globalThis as typeof globalThis & { __awakenWriters?: Map<string, Queue> };

function queueFor(name: string): Queue {
  globalForWriters.__awakenWriters ??= new Map();
  const existing = globalForWriters.__awakenWriters.get(name);
  if (existing) return existing;
  const queue: Queue = { inFlight: new Set(), pending: new Map() };
  globalForWriters.__awakenWriters.set(name, queue);
  return queue;
}

export function createLatestWriter<T>(
  name: string,
  write: (value: T) => Promise<void>,
  onError: (key: string, error: unknown) => void,
): LatestWriter<T> {
  const { inFlight, pending } = queueFor(name);

  const run = (key: string, value: T): void => {
    inFlight.add(key);
    Promise.resolve()
      .then(() => write(value))
      .catch((error: unknown) => onError(key, error))
      .finally(() => {
        inFlight.delete(key);
        if (!pending.has(key)) return;
        const next = pending.get(key) as T;
        pending.delete(key);
        run(key, next);
      });
  };

  return (key, value) => {
    if (inFlight.has(key)) pending.set(key, value);
    else run(key, value);
  };
}
