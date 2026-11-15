import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true) }));

import { PUSHUP_REP_MS, SQUAT_REP_MS, waveform } from '../bridge/simulator';
import { subscribe } from '../lib/bus';
import { logEvent } from '../lib/db';
import type { Quest, Reading, StreamEvent } from '../lib/schemas';
import {
  MAX_WATCH_REPS_PER_REPORT,
  applyWatchReps,
  clearActiveQuest,
  getActiveQuest,
  hasSensorVerifier,
  resetRouter,
  routeReading,
  setActiveQuest,
  setCompletionHandler,
} from './router';
import { withRest } from './verifiers/testing';

const quest = (overrides: Partial<Quest> = {}): Quest => ({
  id: 'q1',
  playerId: 'p1',
  stat: 'STR',
  title: 'Push-ups',
  type: 'pushup',
  target: 3,
  progress: 0,
  xp: 30,
  status: 'active',
  deadline: '2030-01-01T00:00:00Z',
  ...overrides,
});

/** Home Base pad push-ups. */
const pushups = (n: number): Reading[] => withRest(waveform('pushup', n * PUSHUP_REP_MS), 'pushup');
/** Phone-armband squats: 2 calibration reps, then every 4th is half depth. */
const squats = (n: number): Reading[] => withRest(waveform('squat', n * SQUAT_REP_MS), 'squat');
/** The same phone motion, as arm push-ups. */
const phoneReps = squats;

describe('router', () => {
  let events: StreamEvent[];
  let off: () => void;

  beforeEach(() => {
    vi.mocked(logEvent).mockClear();
    resetRouter();
    events = [];
    off = subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  const forQuest = (id: string): StreamEvent[] =>
    events.filter(
      (e) =>
        ((e.type === 'rep' || e.type === 'rep.rejected') && e.questId === id) ||
        ((e.type === 'quest.update' || e.type === 'quest.complete') && e.quest.id === id),
    );

  it('publishes rep → quest.update per rep and quest.complete at the target', () => {
    setActiveQuest(quest());

    pushups(3).forEach(routeReading);

    const q1 = forQuest('q1');
    expect(q1.map((e) => e.type)).toEqual([
      'rep', 'quest.update',
      'rep', 'quest.update',
      'rep', 'quest.update', 'quest.complete',
    ]);
    expect(q1[0]).toEqual({ type: 'rep', playerId: 'p1', questId: 'q1', count: 1 });
    expect(q1[3]).toMatchObject({ type: 'quest.update', quest: { progress: 2, status: 'active' } });
    expect(q1[6]).toMatchObject({
      type: 'quest.complete',
      xpGained: 30,
      quest: { id: 'q1', progress: 3, status: 'done' },
    });
  });

  it('clears the quest once complete and stops counting for it', () => {
    setActiveQuest(quest({ target: 2 }));

    pushups(6).forEach(routeReading);

    expect(getActiveQuest('p1')).toBeUndefined();
    expect(forQuest('q1').filter((e) => e.type === 'rep')).toHaveLength(2);
  });

  it('passes through rep.rejected for shallow reps without adding progress', () => {
    setActiveQuest(quest({ type: 'squat', target: 10 }));

    squats(4).forEach(routeReading); // 4th simulator squat is half depth

    expect(forQuest('q1').at(-1)).toEqual({
      type: 'rep.rejected',
      playerId: 'p1',
      questId: 'q1',
      reason: 'not deep enough',
    });
    expect(getActiveQuest('p1')?.progress).toBe(3);
  });

  it('does not mutate the quest it was given', () => {
    const original = quest();
    setActiveQuest(original);

    pushups(2).forEach(routeReading);

    expect(original.progress).toBe(0);
  });

  it('counts squats from the phone and ignores the Home Base pad for squat quests', () => {
    setActiveQuest(quest({ id: 'q2', type: 'squat', target: 5 }));

    squats(3).forEach(routeReading);
    expect(getActiveQuest('p1')?.progress).toBe(3);

    pushups(2).forEach(routeReading); // pad presses mean nothing to a squat quest
    expect(getActiveQuest('p1')?.progress).toBe(3);
  });

  it('adds push-ups from the pad and from the phone armband into one count', () => {
    setActiveQuest(quest({ target: 10 }));

    pushups(2).forEach(routeReading);
    phoneReps(3).forEach(routeReading); // armPushup: 2 calibration reps + 1

    expect(getActiveQuest('p1')?.progress).toBe(5);
    expect(
      forQuest('q1').flatMap((e) => (e.type === 'rep' ? [e.count] : [])),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(['jumpingjack', 'situp'] as const)('routes %s quests to the phone accel verifier', (type) => {
    setActiveQuest(quest({ type, target: 10 }));

    phoneReps(3).forEach(routeReading);

    expect(getActiveQuest('p1')?.progress).toBe(3);
  });

  it('counts Watch accel readings like phone ones', () => {
    setActiveQuest(quest({ type: 'squat', target: 10 }));

    squats(3).map((r) => ({ ...r, source: 'watch' as const })).forEach(routeReading);

    expect(getActiveQuest('p1')?.progress).toBe(3);
  });

  it('holds quest types that have no sensor verifier yet without publishing', () => {
    setActiveQuest(quest({ id: 'q3', type: 'jail', target: 30 }));

    pushups(2).forEach(routeReading);

    expect(getActiveQuest('p1')?.progress).toBe(0);
    expect(events).toEqual([]);
  });

  it('routes readings to the most recently started quest', () => {
    setActiveQuest(quest({ id: 'qa', playerId: 'a' }));
    setActiveQuest(quest({ id: 'qb', playerId: 'b' }));

    pushups(1).forEach(routeReading);

    expect(getActiveQuest('a')?.progress).toBe(0);
    expect(getActiveQuest('b')?.progress).toBe(1);
  });

  it('rejects quests that are not active', () => {
    expect(() => setActiveQuest(quest({ status: 'done' }))).toThrow(/active/);
  });

  it('clearActiveQuest stops routing for that player', () => {
    setActiveQuest(quest());
    clearActiveQuest('p1');

    pushups(1).forEach(routeReading);

    expect(forQuest('q1')).toEqual([]);
  });

  it('ignores readings when no quest has been started', () => {
    pushups(2).forEach(routeReading);

    expect(events).toEqual([]);
  });

  it('hands completed quests to the registered completion handler instead of publishing', () => {
    const completed: Quest[] = [];
    setCompletionHandler((q) => completed.push(q));
    setActiveQuest(quest({ target: 2 }));

    pushups(2).forEach(routeReading);

    expect(completed).toEqual([expect.objectContaining({ id: 'q1', status: 'done', progress: 2 })]);
    expect(events.some((e) => e.type === 'quest.complete')).toBe(false);
  });

  it('knows which quest types have sensor verifiers', () => {
    expect(['pushup', 'squat', 'jumpingjack', 'situp'].every((t) => hasSensorVerifier(t as Quest['type']))).toBe(true);
    expect(hasSensorVerifier('steps')).toBe(false);
  });

  it('logs verified reps and rejected reps to Tiger with their source', () => {
    setActiveQuest(quest({ type: 'squat', target: 10 }));

    squats(4).forEach(routeReading);

    const kinds = vi.mocked(logEvent).mock.calls.map(([e]) => `${e.kind}:${e.verified}:${e.source}`);
    expect(kinds).toEqual([
      'rep:true:phone', 'rep:true:phone', 'rep:true:phone', 'rep.rejected:false:phone',
    ]);
  });

  describe('applyWatchReps', () => {
    it('caps one report at MAX_WATCH_REPS_PER_REPORT', () => {
      setActiveQuest(quest({ type: 'squat', target: 500 }));

      const result = applyWatchReps('p1', 'squat', 9_999);

      expect(result).toMatchObject({ ok: true, applied: MAX_WATCH_REPS_PER_REPORT, progress: MAX_WATCH_REPS_PER_REPORT });
    });

    it('applies to the reporting player only', () => {
      setActiveQuest(quest({ type: 'pushup', target: 5 }));
      expect(applyWatchReps('p1', 'pushup', 1)).toMatchObject({ ok: true, applied: 1 });
      expect(applyWatchReps('p2', 'pushup', 1)).toMatchObject({ ok: false });
    });

    it('punch quests are counted by the Watch only', () => {
      expect(hasSensorVerifier('punch')).toBe(true);
    });
  });
});
