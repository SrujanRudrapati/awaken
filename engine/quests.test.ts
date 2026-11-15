import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../lib/device', () => ({
  send: vi.fn().mockResolvedValue(true),
  sendAll: vi.fn().mockResolvedValue(true),
}));

import { PUSHUP_REP_MS, waveform } from '../bridge/simulator';
import { subscribe } from '../lib/bus';
import * as db from '../lib/db';
import { send, sendAll } from '../lib/device';
import { notify } from '../lib/notify';
import type { Reading, StreamEvent } from '../lib/schemas';
import { DAILY_TEMPLATES } from './progression';
import {
  EMERGENCY_SECONDS,
  QuestError,
  completeQuest,
  createPlayer,
  dailyDrop,
  emergencyQuest,
  failQuest,
  getPlayer,
  getQuest,
  listQuests,
  purgePlayers,
  resetEngine,
  startQuest,
  sweepExpired,
} from './quests';
import { getActiveQuest, resetRouter, routeReading } from './router';
import { withRest } from './verifiers/testing';

const pushups = (n: number, startT = 0): Reading[] =>
  withRest(waveform('pushup', n * PUSHUP_REP_MS), 'pushup').map((r) => ({ ...r, t: r.t + startT }));

describe('quest engine', () => {
  let events: StreamEvent[];
  let off: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    events = [];
    off = subscribe((e) => events.push(e));
  });
  afterEach(() => {
    off();
    vi.useRealTimers();
  });

  const ofType = <T extends StreamEvent['type']>(type: T) =>
    events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);

  it('creates an E-rank level-1 player with zero stats and persists it', async () => {
    const player = await createPlayer({ name: 'Jin', id: 'p1' });

    expect(player).toMatchObject({ id: 'p1', rank: 'E', level: 1, xp: 0, penalty: false });
    expect(Object.values(player.stats).every((v) => v === 0)).toBe(true);
    expect(db.upsertPlayer).toHaveBeenCalledWith(player);
    expect(await createPlayer({ name: 'Other', id: 'p1' })).toBe(player); // idempotent
  });

  it('loads unknown players from Tiger Data', async () => {
    vi.mocked(db.getPlayer).mockResolvedValueOnce({
      id: 'old', name: 'Old', rank: 'D', level: 4, xp: 160, penalty: false,
      stats: { STR: 3, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 },
    });

    expect((await getPlayer('old'))?.xp).toBe(160);
  });

  it('rejects quests for unknown players', async () => {
    await expect(startQuest('ghost', { type: 'pushup' })).rejects.toMatchObject({ status: 404 });
  });

  it('counts a pad push-up quest to completion and awards XP, stat and level', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'pushup', difficulty: 'normal', target: 3 });

    pushups(3).forEach(routeReading);
    await vi.waitFor(() => expect(getQuest(quest.id)?.status).toBe('done'));

    const player = await getPlayer('p1');
    expect(player).toMatchObject({ xp: 30, level: 1, stats: expect.objectContaining({ STR: 1 }) });
    expect(ofType('quest.complete')).toEqual([expect.objectContaining({ xpGained: 30 })]);
    expect(db.logEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'xp', value: 30, stat: 'STR' }));
    expect(sendAll).toHaveBeenCalledWith(['BUZZ:chime', 'SEG:   3']);
  });

  it('publishes levelup and shows LVUP then the rank on the display', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'gate', difficulty: 'hard' }); // 120 XP

    const { leveledUp, player } = await completeQuest('p1', quest.id);

    expect(leveledUp).toBe(true);
    expect(player).toMatchObject({ xp: 120, level: 3, rank: 'D' });
    expect(ofType('levelup')).toEqual([{ type: 'levelup', playerId: 'p1', fromRank: 'E', toRank: 'D', level: 3 }]);
    expect(sendAll).toHaveBeenCalledWith(['BUZZ:chime', 'SEG:LVUP']);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '[QUEST COMPLETE]' }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[LEVEL UP]', message: 'Jin reached level 3 · Rank D', priority: 'high' }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledWith('SEG:RK-D');
  });

  it('refuses to complete a sensor quest outside the router', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'pushup' });

    await expect(completeQuest('p1', quest.id)).rejects.toMatchObject({ status: 409 });
    expect((await getPlayer('p1'))?.xp).toBe(0);
  });

  it('does not lose XP when two quests complete in the same tick', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quiz = await startQuest('p1', { type: 'quiz' });
    const photo = await startQuest('p1', { type: 'photo' });

    await Promise.all([completeQuest('p1', quiz.id), completeQuest('p1', photo.id)]);

    expect((await getPlayer('p1'))?.xp).toBe(quiz.xp + photo.xp);
  });

  it('resuming a quest re-points the Home Base at that player', async () => {
    await createPlayer({ name: 'A', id: 'a' });
    await createPlayer({ name: 'B', id: 'b' });
    const questA = await startQuest('a', { type: 'pushup', target: 10 });
    pushups(2).forEach(routeReading);
    await startQuest('b', { type: 'squat', target: 10 }); // B takes over the Home Base

    await startQuest('a', { questId: questA.id });
    pushups(2, 100_000).forEach(routeReading);

    expect(getQuest(questA.id)?.progress).toBe(4);
  });

  it('starting the same quest type twice resumes it instead of duplicating', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const first = await startQuest('p1', { type: 'pushup' });

    const second = await startQuest('p1', { type: 'pushup' });

    expect(second.id).toBe(first.id);
    expect(listQuests('p1').filter((q) => q.type === 'pushup')).toHaveLength(1);
  });

  it('refuses to resume a quest past its deadline', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'quiz', deadline: new Date(Date.now() - 1_000), kind: 'manual' });

    await expect(startQuest('p1', { questId: quest.id })).rejects.toMatchObject({ status: 409 });
  });

  it('does not complete a quest twice', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'quiz' });
    await completeQuest('p1', quest.id);

    await expect(completeQuest('p1', quest.id)).rejects.toBeInstanceOf(QuestError);
    expect((await getPlayer('p1'))?.xp).toBe(45);
  });

  it('fail → Penalty Zone, alarm, FAIL on display, harder penalty quest', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'squat', difficulty: 'normal' });

    const { penaltyQuest } = await failQuest('p1', quest.id, 'Gave up');

    expect(getQuest(quest.id)?.status).toBe('failed');
    expect((await getPlayer('p1'))?.penalty).toBe(true);
    expect(ofType('penalty')).toEqual([{ type: 'penalty', playerId: 'p1', questId: quest.id, reason: 'Gave up' }]);
    expect(sendAll).toHaveBeenCalledWith(['BUZZ:alarm', 'SEG:FAIL']);
    expect(notify).toHaveBeenCalledWith({ title: '[PENALTY ZONE]', message: 'Gave up', priority: 'urgent', tags: ['warning'] });
    expect(penaltyQuest).toMatchObject({ type: 'squat', difficulty: 'hard', kind: 'penalty', status: 'active' });
    expect(getActiveQuest('p1')).toBeUndefined(); // sensors stop counting the failed quest
  });

  it('a failed hard or custom-target quest comes back 1.5x bigger', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const hard = await startQuest('p1', { type: 'squat', difficulty: 'hard' });
    const custom = await startQuest('p1', { type: 'pushup', target: 10, kind: 'manual' });

    const fromHard = await failQuest('p1', hard.id, 'x');
    const fromCustom = await failQuest('p1', custom.id, 'x');

    expect(fromHard.penaltyQuest?.target).toBe(75);
    expect(fromCustom.penaltyQuest?.target).toBe(15);
  });

  it('the Penalty Zone stays until every penalty quest is done', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quizA = await startQuest('p1', { type: 'quiz' });
    const quizB = await startQuest('p1', { type: 'photo' });
    const { penaltyQuest: pA } = await failQuest('p1', quizA.id, 'x');
    const { penaltyQuest: pB } = await failQuest('p1', quizB.id, 'x');

    await completeQuest('p1', pA!.id);
    expect((await getPlayer('p1'))?.penalty).toBe(true);
    await completeQuest('p1', pB!.id);
    expect((await getPlayer('p1'))?.penalty).toBe(false);
  });

  it('completing the penalty quest clears the Penalty Zone', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const quest = await startQuest('p1', { type: 'quiz' });
    const { penaltyQuest } = await failQuest('p1', quest.id, 'Failed quiz');

    await completeQuest('p1', penaltyQuest!.id);

    expect((await getPlayer('p1'))?.penalty).toBe(false);
  });

  it('switching sensor quests keeps the paused quest progress and resumes it', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const first = await startQuest('p1', { type: 'pushup', target: 10 });
    pushups(2).forEach(routeReading);

    await startQuest('p1', { type: 'squat', target: 10 });
    expect(getQuest(first.id)?.progress).toBe(2);

    await startQuest('p1', { questId: first.id });
    pushups(1, 100_000).forEach(routeReading);
    expect(getQuest(first.id)?.progress).toBe(3);
  });

  it('non-sensor quests do not take over the sensors', async () => {
    await createPlayer({ name: 'Jin', id: 'p1' });
    const reps = await startQuest('p1', { type: 'pushup', target: 10 });

    await startQuest('p1', { type: 'steps' });

    expect(getActiveQuest('p1')?.id).toBe(reps.id);
  });

  it('purgePlayers removes only matching players, their quests, countdowns and sensor focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await createPlayer({ name: 'Demo', id: 'demo-1' });
    await createPlayer({ name: 'Real', id: 'real' });
    const demoQuest = await emergencyQuest('demo-1');
    const realQuest = await startQuest('real', { type: 'squat' });

    expect(purgePlayers((id) => id.startsWith('demo-'))).toBe(1);
    await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000 + 1_000);

    expect(await getPlayer('demo-1')).toBeNull();
    expect(getQuest(demoQuest.id)).toBeUndefined();
    expect(getActiveQuest('demo-1')).toBeUndefined();
    expect(ofType('penalty')).toHaveLength(0); // countdown stopped, no ghost failure
    expect(await getPlayer('real')).not.toBeNull();
    expect(getQuest(realQuest.id)?.status).toBe('active');
  });

  describe('emergency quest', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

    it('counts down on the display and fails with a penalty when time runs out', async () => {
      await createPlayer({ name: 'Jin', id: 'p1' });
      const quest = await emergencyQuest('p1');

      expect(quest).toMatchObject({ kind: 'emergency', target: 10, type: 'pushup' });
      expect(sendAll).toHaveBeenCalledWith(['BUZZ:alarm', 'SEG:  30']);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '[EMERGENCY QUEST]', priority: 'urgent' }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(send).toHaveBeenCalledWith('SEG:  29');

      await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000);

      expect(getQuest(quest.id)?.status).toBe('failed');
      expect(ofType('penalty')).toHaveLength(1);
    });

    it('completes if 10 reps land in time, and the countdown stops', async () => {
      await createPlayer({ name: 'Jin', id: 'p1' });
      const quest = await emergencyQuest('p1');

      pushups(10).forEach(routeReading);
      await vi.waitFor(() => expect(getQuest(quest.id)?.status).toBe('done'));
      vi.mocked(send).mockClear();
      await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000);

      expect(getQuest(quest.id)?.status).toBe('done');
      expect(ofType('penalty')).toHaveLength(0);
      expect(vi.mocked(send).mock.calls.filter(([c]) => /SEG: +\d+$/.test(c))).toEqual([]);
    });
    it('a second emergency while one is running returns the running one', async () => {
      await createPlayer({ name: 'Jin', id: 'p1' });
      const first = await emergencyQuest('p1');

      const second = await emergencyQuest('p1');

      expect(second.id).toBe(first.id);
      expect(listQuests('p1').filter((q) => q.kind === 'emergency')).toHaveLength(1);
    });

    it('starting another sensor quest cancels the emergency without a penalty', async () => {
      await createPlayer({ name: 'A', id: 'a' });
      await createPlayer({ name: 'B', id: 'b' });
      const emergency = await emergencyQuest('a');

      await startQuest('b', { type: 'pushup' });
      await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000 + 1_000);

      expect(getQuest(emergency.id)?.status).toBe('cancelled');
      expect(ofType('penalty')).toHaveLength(0);
      expect(sendAll).not.toHaveBeenCalledWith(['BUZZ:alarm', 'SEG:FAIL']);
    });

    describe('demo mode', () => {
      afterEach(() => {
        delete process.env.DEMO_MODE;
      });

      it("DEMO_MODE=1: a new player's first emergency ranks them up E→D", async () => {
        process.env.DEMO_MODE = '1';
        await createPlayer({ name: 'Jin', id: 'demo-1' });

        const quest = await emergencyQuest('demo-1');
        pushups(10).forEach(routeReading);
        await vi.waitFor(() => expect(getQuest(quest.id)?.status).toBe('done'));

        expect(quest.xp).toBe(100);
        expect(await getPlayer('demo-1')).toMatchObject({ rank: 'D', xp: 100 });
        expect(ofType('levelup')).toEqual([expect.objectContaining({ fromRank: 'E', toRank: 'D' })]);
      });

      it('DEMO_MODE=1: only the first emergency gets the bonus', async () => {
        process.env.DEMO_MODE = '1';
        await createPlayer({ name: 'Jin', id: 'demo-1' });
        await emergencyQuest('demo-1');
        await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000 + 1_000);

        const second = await emergencyQuest('demo-1');

        expect(second.xp).toBe(40);
      });

      it('normal mode keeps the balanced emergency XP', async () => {
        await createPlayer({ name: 'Jin', id: 'p1' });

        expect((await emergencyQuest('p1')).xp).toBe(40);
      });
    });

    it('a failed emergency gives a 15-rep penalty quest, not 40', async () => {
      await createPlayer({ name: 'Jin', id: 'p1' });
      await emergencyQuest('p1');

      await vi.advanceTimersByTimeAsync(EMERGENCY_SECONDS * 1_000 + 1_000);

      expect(listQuests('p1').find((q) => q.kind === 'penalty')?.target).toBe(15);
    });
  });

  describe('daily drop', () => {
    it('does not re-issue a daily already completed today', async () => {
      await createPlayer({ name: 'A', id: 'a' });
      const now = new Date();
      const first = await dailyDrop(now);
      const quiz = first.a.find((q) => q.type === 'quiz');
      if (quiz) await completeQuest('a', quiz.id);

      const second = await dailyDrop(now);

      expect(second.a).toEqual([]);
    });

    it('one alarm and one penalty quest per player for many missed quests', async () => {
      await createPlayer({ name: 'A', id: 'a' });
      await dailyDrop(new Date(2026, 10, 14, 12));
      vi.mocked(sendAll).mockClear();

      await dailyDrop(new Date(2026, 10, 15, 0, 1));

      expect(listQuests('a').filter((q) => q.kind === 'penalty')).toHaveLength(1);
      expect(vi.mocked(sendAll).mock.calls.filter(([c]) => c.includes('BUZZ:alarm'))).toHaveLength(1);
    });

    it('drops the template quests for every player, once per day', async () => {
      await createPlayer({ name: 'A', id: 'a' });
      await createPlayer({ name: 'B', id: 'b' });
      const now = new Date(2026, 10, 15, 0, 0, 5);

      const first = await dailyDrop(now);
      const second = await dailyDrop(now);

      expect(first.a.map((q) => q.type)).toEqual(DAILY_TEMPLATES.map((t) => t.type));
      expect(first.b).toHaveLength(DAILY_TEMPLATES.length);
      expect(first.a.every((q) => q.kind === 'daily' && q.deadline.startsWith('2026-11-1'))).toBe(true);
      expect(second.a).toEqual([]);
      const daily = vi.mocked(notify).mock.calls.filter(([n]) => n.title === '[DAILY QUEST HAS ARRIVED]');
      expect(daily).toHaveLength(1); // one alert for the drop, none for the empty second call
      expect(daily[0][0].message.split('\n')).toHaveLength(DAILY_TEMPLATES.length); // titles deduped across players
    });

    it('includes players only known to Tiger Data', async () => {
      vi.mocked(db.listPlayers).mockResolvedValueOnce([
        { id: 'stored', name: 'S', rank: 'E', level: 1, xp: 0, penalty: false,
          stats: { STR: 0, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 } },
      ]);

      expect(Object.keys(await dailyDrop())).toEqual(['stored']);
    });

    it('fails missed quests into the Penalty Zone before dropping new ones', async () => {
      await createPlayer({ name: 'A', id: 'a' });
      const yesterday = new Date(2026, 10, 14, 12);
      await dailyDrop(yesterday);

      await dailyDrop(new Date(2026, 10, 15, 0, 1));

      expect(listQuests('a').filter((q) => q.status === 'failed')).toHaveLength(DAILY_TEMPLATES.length);
      expect((await getPlayer('a'))?.penalty).toBe(true);
    });

    it('uses a custom designer and falls back to templates if it throws', async () => {
      await createPlayer({ name: 'A', id: 'a' });

      const custom = await dailyDrop(new Date(), async () => [{ type: 'situp', difficulty: 'easy' }]);
      resetEngine();
      await createPlayer({ name: 'A', id: 'a' });
      const fallback = await dailyDrop(new Date(), async () => {
        throw new Error('Gemini down');
      });

      expect(custom.a.map((q) => q.type)).toEqual(['situp']);
      expect(fallback.a).toHaveLength(DAILY_TEMPLATES.length);
    });
  });

  it('sweepExpired leaves running emergency quests to their own timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await createPlayer({ name: 'Jin', id: 'p1' });
    await emergencyQuest('p1');

    expect(await sweepExpired(new Date(Date.now() + 60_000))).toBe(0);
  });
});
