import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/llm', () => ({ claudeJson: vi.fn() }));

import { claudeJson } from '../../lib/llm';
import { createPlayer, getPlayer, getQuest, resetEngine, startQuest } from '../quests';
import { resetRouter } from '../router';
import { answerQuiz, resetQuizzes, startQuiz } from './quiz';
import { FALLBACK_QUESTIONS } from './quizBank';

const generated = {
  questions: [
    { question: 'What is 2 + 2?', options: ['3', '4', '5', '6'], answerIndex: 1 },
    { question: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo', 'Bern'], answerIndex: 0 },
    { question: 'Color of the sky?', options: ['Red', 'Green', 'Blue', 'Pink'], answerIndex: 2 },
  ],
};

describe('focus quiz', () => {
  let questId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    resetQuizzes();
    await createPlayer({ name: 'Jin', id: 'p1' });
    questId = (await startQuest('p1', { type: 'quiz' })).id;
  });

  it('two overlapping starts get the same questions, and grading uses the ones shown', async () => {
    const other = { questions: generated.questions.map((q) => ({ ...q, question: `Other: ${q.question}`, answerIndex: 3 })) };
    vi.mocked(claudeJson).mockResolvedValueOnce(generated).mockResolvedValueOnce(other);

    const [first, second] = await Promise.all([startQuiz('p1', questId), startQuiz('p1', questId)]);

    expect(second).toEqual(first);
    const result = await answerQuiz('p1', questId, [1, 0, 2]);
    expect(result.correct).toBe(3);
    expect(result.passed).toBe(true);
  });

  it('never sends answers to the client', async () => {
    vi.mocked(claudeJson).mockResolvedValue(generated);

    const questions = await startQuiz('p1', questId, 'biology');

    expect(questions).toHaveLength(3);
    expect(JSON.stringify(questions)).not.toContain('answerIndex');
    expect(vi.mocked(claudeJson).mock.calls[0][0].prompt).toContain('biology');
  });

  it('2 of 3 correct passes: quest done, XP awarded', async () => {
    vi.mocked(claudeJson).mockResolvedValue(generated);
    await startQuiz('p1', questId);

    const result = await answerQuiz('p1', questId, [1, 0, 3]);

    expect(result).toMatchObject({ correct: 2, passed: true, answers: [1, 0, 2] });
    expect(getQuest(questId)?.status).toBe('done');
    expect((await getPlayer('p1'))?.stats.INT).toBe(1);
  });

  it('1 of 3 fails the quest into the Penalty Zone, and allows only one attempt', async () => {
    vi.mocked(claudeJson).mockResolvedValue(generated);
    await startQuiz('p1', questId);

    const result = await answerQuiz('p1', questId, [1, 1, 1]);

    expect(result.passed).toBe(false);
    expect(getQuest(questId)?.status).toBe('failed');
    await expect(answerQuiz('p1', questId, [1, 0, 2])).rejects.toMatchObject({ status: 409 });
  });

  it('falls back to the offline bank when Haiku fails or writes bad questions', async () => {
    vi.mocked(claudeJson).mockResolvedValue({ questions: [{ question: 'x', options: ['a'], answerIndex: 9 }] });

    const questions = await startQuiz('p1', questId);

    expect(questions.map((q) => q.question)).toEqual(FALLBACK_QUESTIONS.slice(0, 3).map((q) => q.question));
  });

  it('asking again returns the same questions (no regenerate-until-easy)', async () => {
    vi.mocked(claudeJson).mockResolvedValue(generated);
    const first = await startQuiz('p1', questId);
    vi.mocked(claudeJson).mockResolvedValue(null);

    expect(await startQuiz('p1', questId)).toEqual(first);
  });

  it('refuses non-quiz quests and wrong answer counts', async () => {
    const pushup = await startQuest('p1', { type: 'pushup' });
    await expect(startQuiz('p1', pushup.id)).rejects.toMatchObject({ status: 400 });
    vi.mocked(claudeJson).mockResolvedValue(generated);
    await startQuiz('p1', questId);
    await expect(answerQuiz('p1', questId, [1])).rejects.toMatchObject({ status: 400 });
  });
});
