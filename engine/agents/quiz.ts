/**
 * Focus quiz (after Phone Jail): Haiku writes 3 multiple-choice questions, the code grades them.
 * Answers never leave the server; ≥ 2 of 3 correct completes the quiz quest, fewer fails it.
 * Offline / bad output → questions from the fallback bank.
 */
import { z } from 'zod';
import { claudeJson } from '../../lib/llm';
import { HAIKU } from '../../lib/models';
import { QuestError, completeQuest, failQuest, getQuest, type CompletionResult } from '../quests';
import { FALLBACK_QUESTIONS } from './quizBank';

export const QUIZ_LENGTH = 3;
export const PASS_MARK = 2;
const OPTIONS = 4;

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
}

/** Loose for structured outputs (array length limits aren't expressible there); checked strictly below. */
const GeneratedSchema = z.object({
  questions: z.array(z.object({ question: z.string(), options: z.array(z.string()), answerIndex: z.number().int() })),
});

const QuestionSchema = z.object({
  question: z.string().trim().min(5).max(200),
  options: z.array(z.string().trim().min(1).max(80)).length(OPTIONS),
  answerIndex: z.number().int().min(0).max(OPTIONS - 1),
});

const QUIZ_SYSTEM = `You write short multiple-choice quiz questions to check that a person really studied.
Exactly ${QUIZ_LENGTH} questions, each with exactly ${OPTIONS} options and one correct answer (answerIndex is 0-based).
Factual, unambiguous, answerable in 10 seconds. No trick questions.`;

interface QuizState {
  quizzes: Map<string, QuizQuestion[]>;
  cursor: number;
}
const globalForQuiz = globalThis as typeof globalThis & { __awakenQuiz?: QuizState };
function state(): QuizState {
  globalForQuiz.__awakenQuiz ??= { quizzes: new Map(), cursor: 0 };
  return globalForQuiz.__awakenQuiz;
}

function fallbackQuestions(): QuizQuestion[] {
  const s = state();
  const picked = Array.from({ length: QUIZ_LENGTH }, (_, i) => FALLBACK_QUESTIONS[(s.cursor + i) % FALLBACK_QUESTIONS.length]);
  s.cursor += QUIZ_LENGTH;
  return picked.map((q) => ({ ...q, options: [...q.options] }));
}

async function generate(topic: string): Promise<QuizQuestion[]> {
  const generated = await claudeJson(
    { model: HAIKU, system: QUIZ_SYSTEM, prompt: `Topic the player studied: ${topic}`, maxTokens: 2_000 },
    GeneratedSchema,
  );
  const valid = (generated?.questions ?? []).flatMap((q) => {
    const parsed = QuestionSchema.safeParse(q);
    return parsed.success ? [parsed.data] : [];
  });
  return valid.length >= QUIZ_LENGTH ? valid.slice(0, QUIZ_LENGTH) : fallbackQuestions();
}

/** What the client sees: no answers. */
export interface PublicQuestion {
  question: string;
  options: string[];
}

function requireQuizQuest(playerId: string, questId: string): void {
  const quest = getQuest(questId);
  if (!quest || quest.playerId !== playerId) throw new QuestError(`No vow ${questId} for ${playerId}`, 404);
  if (quest.type !== 'quiz') throw new QuestError(`Vow ${questId} is not a trial`, 400);
  if (quest.status !== 'active') throw new QuestError(`Vow ${questId} is already ${quest.status}`, 409);
}

/** Creates (or returns the already-issued) questions for an active quiz quest. */
export async function startQuiz(playerId: string, questId: string, topic = 'general knowledge'): Promise<PublicQuestion[]> {
  requireQuizQuest(playerId, questId);
  if (!state().quizzes.has(questId)) {
    const generated = await generate(topic);
    // An overlapping start may have stored a set while we waited: first one wins, so the screen and the grader agree.
    if (!state().quizzes.has(questId)) state().quizzes.set(questId, generated);
  }
  const questions = state().quizzes.get(questId) ?? [];
  return questions.map(({ question, options }) => ({ question, options }));
}

export interface QuizResult {
  correct: number;
  passed: boolean;
  /** Correct option per question, revealed after grading. */
  answers: number[];
  completion: CompletionResult | null;
}

/** Grades in code. ≥ PASS_MARK correct → quest complete; otherwise the quest fails (Penalty Zone). */
export async function answerQuiz(playerId: string, questId: string, answers: readonly number[]): Promise<QuizResult> {
  requireQuizQuest(playerId, questId);
  const questions = state().quizzes.get(questId);
  if (!questions) throw new QuestError('Start the trial first', 409);
  if (answers.length !== questions.length) throw new QuestError(`Send ${questions.length} answers`, 400);

  state().quizzes.delete(questId); // one attempt
  const correct = questions.filter((q, i) => q.answerIndex === answers[i]).length;
  const passed = correct >= PASS_MARK;
  const completion = passed
    ? await completeQuest(playerId, questId)
    : (await failQuest(playerId, questId, `Focus trial failed: ${correct}/${questions.length} correct`), null);
  return { correct, passed, answers: questions.map((q) => q.answerIndex), completion };
}

/** Forgets issued questions for these vows (demo reset). */
export function forgetQuizzes(questIds: readonly string[]): void {
  questIds.forEach((id) => state().quizzes.delete(id));
}

/** Test hook. */
export function resetQuizzes(): void {
  globalForQuiz.__awakenQuiz = undefined;
}
