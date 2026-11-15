import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  insertCalibration: vi.fn().mockResolvedValue(null),
  latestCalibration: vi.fn().mockResolvedValue(null),
  dailyAverage: vi.fn().mockResolvedValue(null),
  insertSleepSamples: vi.fn().mockResolvedValue(null),
  listSleepSamples: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/memory', () => ({ recall: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/voice/tts', () => ({ speak: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/llm', () => {
  const q = (level: number, n: number) => ({ question: `Level ${level} question ${n}?`, options: ['right', 'b', 'c', 'd'], answerIndex: 0, level });
  const questions = [1, 2, 3].flatMap((level) => [1, 2, 3, 4].map((n) => q(level, n)));
  return { geminiJson: vi.fn().mockResolvedValue({ questions }), claude: vi.fn().mockResolvedValue(null) };
});

import { subscribe } from '../../lib/bus';
import * as db from '../../lib/db';
import type { Reading, StreamEvent } from '../../lib/schemas';
import { createPlayer, getPlayer, getQuest, resetEngine } from '../quests';
import { resetRouter, routeReading } from '../router';
import { RECALIBRATION_BONUS, SENSOR_WINDOW_MS, resetCalibration, startCalibration, submitCalibration } from './session';

/** `count` clean pad push-ups (press 300 ms, one per second), 100 ms samples. */
function padPushups(count: number): Reading[] {
  return Array.from({ length: count * 10 }, (_, i) => ({ t: i * 100, source: 'homebase', pad: i % 10 < 3 ? 1 : 0 }));
}

async function runAll(playerId: string, pushups: number) {
  await submitCalibration(playerId, { stage: 'body', action: 'begin' });
  padPushups(pushups).forEach(routeReading);
  await vi.advanceTimersByTimeAsync(SENSOR_WINDOW_MS); // the window closes itself

  await submitCalibration(playerId, { stage: 'vitality', action: 'begin' });
  await vi.advanceTimersByTimeAsync(SENSOR_WINDOW_MS); // no jumping jacks seen → 0

  let step = await submitCalibration(playerId, { stage: 'mind', action: 'begin' });
  let question = (step.stage as { question: { id: string } | null }).question;
  while (question) {
    step = await submitCalibration(playerId, { stage: 'mind', action: 'answer', questionId: question.id, answerIndex: 0 });
    question = (step.stage as { next: { id: string } | null }).next;
  }

  const focus = await submitCalibration(playerId, { stage: 'focus', action: 'begin' });
  const trials = (focus.stage as { trials: { i: number; kind: string }[] }).trials;
  return submitCalibration(playerId, {
    stage: 'focus',
    action: 'submit',
    responses: trials.filter((t) => t.kind === 'go').map((t) => ({ i: t.i, rtMs: 320 })),
  });
}

describe('Calibration session', () => {
  let events: StreamEvent[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    resetCalibration();
    events = [];
    subscribe((e) => events.push(e));
    await createPlayer({ name: 'Jin', id: 'p1' });
  });
  afterEach(() => vi.useRealTimers());

  it('measures all four stages from sensors and code, then sets rank, stats and baselines', async () => {
    await startCalibration('p1', { age: 25 });
    const final = await runAll('p1', 30);

    const result = final.session.result!;
    expect(result.baselines.body).toEqual({ variant: 'pushup', reps: 30 });
    expect(result.scores.body).toBeGreaterThan(50); // 30 push-ups at 25 is above typical
    expect(result.scores.vitality).toBe(0);
    expect(result.scores.mind).toBe(83); // all 8 correct: 2,3,3,3,3 then the hard pool runs out → 2,2,2 = 20/24
    expect(result.scores.focus).toBeGreaterThan(90);
    expect(result.rank).toBe('D');
    const player = await getPlayer('p1');
    expect(player).toMatchObject({ rank: 'D', xp: 100, stats: expect.objectContaining({ DISCIPLINE: 0, CHA: 0, INT: 4 }) });
    expect(db.insertCalibration).toHaveBeenCalledTimes(1);

    const stageEvents = events.filter((e) => e.type === 'calibration.stage');
    expect(stageEvents.filter((e) => e.type === 'calibration.stage' && e.status === 'done').map((e) => e.type === 'calibration.stage' && e.stage)).toEqual(['body', 'vitality', 'mind', 'focus']);
    expect(events.find((e) => e.type === 'calibration.complete')).toMatchObject({ rank: 'D', recalibration: false, bonusXp: 0 });
    expect(events.some((e) => e.type === 'voice' && e.eventType === 'awakening')).toBe(true);
  });

  it('measurement vows give no Proof and are cancelled when the window closes', async () => {
    await startCalibration('p1');
    const begun = await submitCalibration('p1', { stage: 'body', action: 'begin' });
    const questId = (begun.stage as { questId: string }).questId;
    expect(getQuest(questId)).toMatchObject({ kind: 'calibration', xp: 0, status: 'active' });
    await expect(submitCalibration('p1', { stage: 'body', action: 'finish' })).rejects.toThrow(/still open/);

    await vi.advanceTimersByTimeAsync(SENSOR_WINDOW_MS);
    expect(getQuest(questId)?.status).toBe('cancelled');
    expect((await getPlayer('p1'))?.xp).toBe(0);
  });

  it('re-calibration within 30 days is refused; after 30 days it pays bonus Proof and never lowers rank', async () => {
    await startCalibration('p1', { age: 25 });
    await runAll('p1', 30);
    await expect(startCalibration('p1')).rejects.toThrow(/Next Calibration from/);

    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60_000);
    await startCalibration('p1', { age: 25 });
    await runAll('p1', 0); // a weaker day
    const player = await getPlayer('p1');
    expect(player?.xp).toBe(100 + RECALIBRATION_BONUS);
    expect(player?.rank).toBe('D');
    expect(events.filter((e) => e.type === 'calibration.complete').at(-1)).toMatchObject({ recalibration: true, bonusXp: RECALIBRATION_BONUS });
  });

  it('guards: unknown person, no session, wrong question', async () => {
    await expect(startCalibration('nobody')).rejects.toThrow(/No one found/);
    await expect(submitCalibration('p1', { stage: 'mind', action: 'begin' })).rejects.toThrow(/Start Calibration first/);
    await startCalibration('p1');
    await submitCalibration('p1', { stage: 'mind', action: 'begin' });
    await expect(submitCalibration('p1', { stage: 'mind', action: 'answer', questionId: 'nope', answerIndex: 0 })).rejects.toThrow(/not the current question/);
  });
});
