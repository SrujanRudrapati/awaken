import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUSHUP_REP_MS, SQUAT_REP_MS, waveform } from '../bridge/simulator';
import { subscribe } from '../lib/bus';
import type { Quest, Reading, StreamEvent } from '../lib/schemas';
import {
  PRACTICE_PLAYER_ID,
  PRACTICE_QUEST_ID,
  calibratePushup,
  clearActiveQuest,
  getActiveQuest,
  getPushupCalibration,
  resetRouter,
  routeReading,
  setActiveQuest,
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

const pushups = (n: number): Reading[] => withRest(waveform('pushup', n * PUSHUP_REP_MS));
const squats = (n: number): Reading[] => withRest(waveform('squat', n * SQUAT_REP_MS));

describe('router', () => {
  let events: StreamEvent[];
  let off: () => void;

  beforeEach(() => {
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
    setActiveQuest(quest({ target: 10 }));

    pushups(4).forEach(routeReading); // 4th simulator rep is shallow

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

  it('routes squat quests to the squat verifier', () => {
    setActiveQuest(quest({ id: 'q2', type: 'squat', target: 5 }));

    squats(3).forEach(routeReading);

    expect(getActiveQuest('p1')?.progress).toBe(3);
    pushups(2).forEach(routeReading); // distance changes mean nothing to a squat quest
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

  it('falls back to a practice push-up quest when nothing is active', () => {
    pushups(2).forEach(routeReading);

    expect(forQuest(PRACTICE_QUEST_ID).map((e) => e.type)).toEqual([
      'rep', 'quest.update', 'rep', 'quest.update',
    ]);
    expect(getActiveQuest(PRACTICE_PLAYER_ID)).toMatchObject({ progress: 2, target: 10, xp: 0 });
  });

  it('drops the practice quest when a real quest starts', () => {
    pushups(1).forEach(routeReading);

    setActiveQuest(quest());

    expect(getActiveQuest(PRACTICE_PLAYER_ID)).toBeUndefined();
  });

  it('applies calibration to the active and to later push-up quests', () => {
    const tall = (n: number): Reading[] =>
      pushups(n).map((r) => ({ ...r, dist: 20 + ((r.dist - 10) * 40) / 30 }));
    setActiveQuest(quest({ target: 10 }));

    calibratePushup(60, 20);
    tall(2).forEach(routeReading);
    setActiveQuest(quest({ id: 'q9', target: 10 }));
    tall(2).forEach(routeReading);

    expect(getPushupCalibration()).toEqual({ upDist: 60, downDist: 20 });
    expect(forQuest('q1').filter((e) => e.type === 'rep')).toHaveLength(2);
    expect(getActiveQuest('p1')?.progress).toBe(2);
  });

  it('rejects an invalid calibration and keeps the old one', () => {
    calibratePushup(50, 15);

    expect(() => calibratePushup(20, 15)).toThrow(RangeError);
    expect(getPushupCalibration()).toEqual({ upDist: 50, downDist: 15 });
  });
});
