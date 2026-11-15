import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();
const search = vi.fn();
vi.mock('supermemory', () => ({
  Supermemory: class {
    add = add;
    search = search;
  },
}));

import { formatRecall, playerNamespace, recall, remember, resetMemory } from './memory';

describe('memory (Supermemory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemory();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPERMEMORY_API_KEY = 'sm_test';
  });
  afterEach(() => {
    delete process.env.SUPERMEMORY_API_KEY;
  });

  it('one namespace per player, safe characters only', () => {
    expect(playerNamespace('demo-jin')).toBe('player_demo-jin');
    expect(playerNamespace('a/../b c')).toBe('player_a____b_c');
  });

  it('without a key: remember → false, recall → null, no calls', async () => {
    delete process.env.SUPERMEMORY_API_KEY;
    expect(await remember('p1', 'x', { kind: 'goal' })).toBe(false);
    expect(await recall('p1', 'goals')).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it('remember writes to player_<id> with kind metadata; goals process instantly', async () => {
    add.mockResolvedValue({ id: 'd1' });

    expect(await remember('p1', "Player's goal: pass calc", { kind: 'goal', instant: true })).toBe(true);

    const [ns, body] = add.mock.calls[0];
    expect(ns).toBe('player_p1');
    expect(body).toMatchObject({ content: "Player's goal: pass calc", metadata: { kind: 'goal' }, dreaming: 'instant' });
  });

  it('recall formats results, caches them, and a new memory invalidates the cache', async () => {
    search.mockResolvedValue({ results: [{ memory: 'Wants to pass calc' }, { chunk: 'Failed squats  twice' }, { memory: 'Wants to pass calc' }] });
    add.mockResolvedValue({});

    expect(await recall('p1', 'goals')).toBe('Wants to pass calc; Failed squats twice');
    await recall('p1', 'goals');
    expect(search).toHaveBeenCalledTimes(1);

    await remember('p1', 'new fact', { kind: 'quest' });
    await recall('p1', 'goals');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('API errors never throw', async () => {
    add.mockRejectedValue(new Error('401'));
    search.mockRejectedValue(new Error('timeout'));
    expect(await remember('p1', 'x', { kind: 'quest' })).toBe(false);
    expect(await recall('p1', 'q')).toBeNull();
  });

  it('formatRecall: null when empty, capped length', () => {
    expect(formatRecall([])).toBeNull();
    expect(formatRecall([{ memory: '  ' }])).toBeNull();
    expect(formatRecall(Array.from({ length: 10 }, (_, i) => ({ memory: `${i}`.repeat(300) })))!.length).toBeLessThanOrEqual(700);
  });
});
