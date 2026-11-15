import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  latestCalibration: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/llm', () => ({ geminiJson: vi.fn() }));

import { geminiJson } from '../../lib/llm';
import type { Reading } from '../../lib/schemas';
import { createPlayer, getPlayer, getQuest, resetEngine, startQuest } from '../quests';
import { resetRouter, routeReading } from '../router';
import { SECONDS_PER_QUESTION, answerReadingTrial, resetReadingTrials, startReadingTrial } from './readingTrial';

const trial = {
  questions: [0, 1, 2].map((n) => ({ question: `What happened in part ${n}?`, options: ['a', 'b', 'c', 'd'], answerIndex: 1 })),
};
const phoneIn = (seconds: number): Reading[] => Array.from({ length: seconds * 10 + 5 }, (_, i) => ({ t: i * 100, source: 'homebase', jail: 1 }));

async function readFor(seconds: number) {
  const quest = await startQuest('p1', { type: 'read', topic: 'The Hobbit, chapter 5', target: seconds });
  phoneIn(seconds).forEach((r) => routeReading(r));
  await vi.waitFor(() => expect(getQuest(quest.id)?.progress).toBe(seconds));
  return quest;
}

describe('read vow: Phone Jail time + timed trial', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    resetReadingTrials();
    vi.mocked(geminiJson).mockResolvedValue(trial);
    await createPlayer({ name: 'Jin', id: 'p1' });
  });

  it('two overlapping trial starts get the same questions', async () => {
    const quest = await readFor(3);
    const other = { questions: trial.questions.map((q) => ({ ...q, question: `Other: ${q.question}` })) };
    vi.mocked(geminiJson).mockResolvedValueOnce(trial).mockResolvedValueOnce(other);

    const [first, second] = await Promise.all([startReadingTrial('p1', quest.id), startReadingTrial('p1', quest.id)]);

    expect(second.questions).toEqual(first.questions);
  });

  it('reading time alone pays nothing; 2/3 on the trial verifies the vow', async () => {
    const quest = await readFor(3);
    expect(getQuest(quest.id)).toMatchObject({ status: 'active', title: 'Read: The Hobbit, chapter 5 · 1 min', topic: 'The Hobbit, chapter 5' });
    expect((await getPlayer('p1'))!.xp).toBe(0);

    const issued = await startReadingTrial('p1', quest.id);
    expect(issued.questions[0]).not.toHaveProperty('answerIndex');
    expect(vi.mocked(geminiJson).mock.calls[0][0].prompt).toContain('The Hobbit, chapter 5');

    const result = await answerReadingTrial('p1', quest.id, [1, 1, 0]);
    expect(result).toMatchObject({ correct: 2, passed: true, late: false });
    expect(getQuest(quest.id)?.status).toBe('done');
    expect((await getPlayer('p1'))!.xp).toBeGreaterThan(0);
  });

  it('too late or < 2 correct breaks the vow; one attempt only', async () => {
    const quest = await readFor(2);
    const now = Date.now();
    await startReadingTrial('p1', quest.id, now);

    const late = await answerReadingTrial('p1', quest.id, [1, 1, 1], now + 3 * SECONDS_PER_QUESTION * 1_000 + 6_000);
    expect(late).toMatchObject({ late: true, passed: false, correct: 0 });
    expect(getQuest(quest.id)?.status).toBe('failed');
    await expect(answerReadingTrial('p1', quest.id, [1, 1, 1])).rejects.toThrow(/already failed/);
  });

  it('no trial before the reading time; Gemini offline → retry later, never a free pass', async () => {
    await createPlayer({ name: 'Mina', id: 'p2' });
    const unread = await startQuest('p2', { type: 'read', topic: 'Dune ch. 1' });
    await expect(startReadingTrial('p2', unread.id)).rejects.toThrow(/Finish the reading time/);

    const ready = await readFor(1);
    vi.mocked(geminiJson).mockResolvedValue(null);
    await expect(startReadingTrial('p1', ready.id)).rejects.toThrow(/could not write the trial/);
    expect(getQuest(ready.id)?.status).toBe('active');
  });
});
