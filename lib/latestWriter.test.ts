import { describe, expect, it, vi } from 'vitest';
import { createLatestWriter } from './latestWriter';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLatestWriter', () => {
  it('writes one value per key at a time, then only the newest of those that queued up', async () => {
    const releases: (() => void)[] = [];
    const written: number[] = [];
    const write = createLatestWriter<number>(
      't1',
      (v) => new Promise((resolve) => {
        written.push(v);
        releases.push(resolve);
      }),
      vi.fn(),
    );

    write('a', 1);
    write('a', 2);
    write('a', 3);
    await tick();
    expect(written).toEqual([1]);
    releases.shift()?.();
    await tick();
    await tick();

    expect(written).toEqual([1, 3]);
  });

  it('keys are independent', async () => {
    const written: string[] = [];
    const write = createLatestWriter<string>('t2', async (v) => {
      written.push(v);
    }, vi.fn());

    write('a', 'a1');
    write('b', 'b1');
    await tick();

    expect(written.sort()).toEqual(['a1', 'b1']);
  });

  it('a failed write is reported and does not block the next one', async () => {
    const onError = vi.fn();
    const write = vi.fn().mockRejectedValueOnce(new Error('pool exhausted')).mockResolvedValue(undefined);
    const save = createLatestWriter<number>('t3', write, onError);

    save('a', 1);
    save('a', 2);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));

    expect(onError).toHaveBeenCalledWith('a', expect.any(Error));
    expect(write).toHaveBeenLastCalledWith(2);
  });

  it('writers with the same name share one queue (one per Next route bundle)', async () => {
    const releases: (() => void)[] = [];
    const written: string[] = [];
    const slow = (tag: string) => (v: number) => new Promise<void>((resolve) => {
      written.push(`${tag}${v}`);
      releases.push(resolve);
    });
    const bundleA = createLatestWriter<number>('shared', slow('A'), vi.fn());
    const bundleB = createLatestWriter<number>('shared', slow('B'), vi.fn());

    bundleA('p', 1);
    bundleB('p', 2);
    await tick();

    expect(written).toEqual(['A1']); // B waits for A's write to land
    releases.shift()?.();
    await tick();
    await tick();
    expect(written).toEqual(['A1', 'A2']);
  });
});
