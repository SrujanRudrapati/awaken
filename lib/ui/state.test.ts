import { describe, expect, it, vi } from 'vitest';
import type { Quest, StreamEvent } from '../schemas';
import { demoEvents } from './demo';
import { activeQuest, initialState, parseStreamMessage, reduce, type UiState } from './state';

const quest: Quest = {
  id: 'q1',
  playerId: 'demo',
  stat: 'STR',
  title: 'Push-ups',
  type: 'pushup',
  target: 2,
  progress: 0,
  xp: 40,
  status: 'active',
  deadline: '2099-01-01T00:00:00.000Z',
};

function feed(state: UiState, events: StreamEvent[], demo = false): UiState {
  return events.reduce((s, event) => reduce(s, { type: 'event', event, demo }), state);
}

describe('ui reducer', () => {
  it('follows rep → update → complete and awards display XP once', () => {
    let s = feed(initialState(), [
      { type: 'rep', playerId: 'demo', questId: 'q1', count: 1 },
      { type: 'quest.update', quest: { ...quest, progress: 1 } },
      { type: 'rep', playerId: 'demo', questId: 'q1', count: 2 },
      { type: 'quest.update', quest: { ...quest, progress: 2 } },
      { type: 'quest.complete', quest: { ...quest, progress: 2, status: 'done' }, xpGained: 40 },
    ]);
    expect(activeQuest(s)?.progress).toBe(2);
    expect(activeQuest(s)?.status).toBe('done');
    expect(s.lastRep?.count).toBe(2);
    expect(s.xp).toBe(40);
    expect(s.stats.STR).toBe(1);
    expect(s.overlays.map((o) => o.kind)).toEqual(['complete']);

    // A duplicate complete (e.g. replay after reconnect) must not double-count.
    s = feed(s, [{ type: 'quest.complete', quest: { ...quest, progress: 2, status: 'done' }, xpGained: 40 }]);
    expect(s.xp).toBe(40);
    expect(s.overlays).toHaveLength(1);
  });

  it('flashes rejected reps with a fresh seq each time', () => {
    const s1 = feed(initialState(), [{ type: 'rep.rejected', playerId: 'demo', questId: 'q1', reason: 'Not deep enough' }]);
    const s2 = feed(s1, [{ type: 'rep.rejected', playerId: 'demo', questId: 'q1', reason: 'Not deep enough' }]);
    expect(s1.rejected?.reason).toBe('Not deep enough');
    expect(s2.rejected!.seq).toBeGreaterThan(s1.rejected!.seq);
  });

  it('puts level-ups ahead of queued overlays and updates rank', () => {
    const s = feed(initialState(), [
      { type: 'quest.complete', quest: { ...quest, status: 'done' }, xpGained: 120 },
      { type: 'levelup', playerId: 'demo', fromRank: 'E', toRank: 'D', level: 3 },
    ]);
    expect(s.rank).toBe('D');
    expect(s.level).toBe(3);
    expect(s.overlays.map((o) => o.kind)).toEqual(['levelup', 'complete']);
    expect(reduce(s, { type: 'dismissOverlay' }).overlays.map((o) => o.kind)).toEqual(['complete']);
  });

  it('marks the quest failed and enters the Penalty Zone', () => {
    const s = feed(initialState(), [
      { type: 'quest.update', quest },
      { type: 'penalty', playerId: 'demo', questId: 'q1', reason: 'Phone removed' },
    ]);
    expect(s.penalty).toBe(true);
    expect(s.quests.q1.status).toBe('failed');
    expect(reduce(s, { type: 'clearPenalty' }).penalty).toBe(false);
  });

  it('keeps readings without bumping seq and caps voice history', () => {
    const reading = { t: 1, dist: 30, ax: 0, ay: 0, az: 1, jail: 0, touch: 0, light: 500, snd: 100, bottle: 0, btn: 0 } as const;
    let s = feed(initialState(), [{ type: 'reading', reading }]);
    expect(s.reading?.dist).toBe(30);
    expect(s.seq).toBe(0);
    for (let i = 0; i < 10; i++) s = feed(s, [{ type: 'voice', text: `line ${i}`, eventType: 'test' }]);
    expect(s.voice).toHaveLength(6);
    expect(s.voice.at(-1)?.text).toBe('line 9');
  });
});

describe('parseStreamMessage', () => {
  it('accepts on-contract events and drops the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseStreamMessage(JSON.stringify({ type: 'voice', text: 'Rise.', eventType: 'x' }))?.type).toBe('voice');
    expect(parseStreamMessage('not json')).toBeNull();
    expect(parseStreamMessage(JSON.stringify({ type: 'rep', count: -1 }))).toBeNull();
    warn.mockRestore();
  });
});

describe('demo mode', () => {
  it('counts reps to completion and marks state as demo', () => {
    let s = initialState();
    for (let i = 0; i < 10; i++) s = feed(s, demoEvents('r', s), true);
    expect(s.demo).toBe(true);
    expect(activeQuest(s)?.status).toBe('done');
    expect(s.overlays[0]?.kind).toBe('complete');
  });

  it('levels up one rank at a time', () => {
    const s = feed(initialState(), demoEvents('l', initialState()), true);
    expect(s.rank).toBe('D');
  });
});
