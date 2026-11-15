/**
 * Reading trial: after a read vow's Phone Jail time, Gemini writes 3 questions on what was
 * read; the person answers against a clock (30 s per question); code grades. ≥ 2/3 → the read
 * vow is verified (Proof), fewer → broken (the Reckoning). One attempt. No canned fallback:
 * generic questions cannot prove someone read *this* chapter, so offline = try again later.
 */
import { z } from 'zod';
import { geminiJson } from '../../lib/llm';
import { QuestError, completeReadingVow, failQuest, getQuest, type CompletionResult } from '../quests';

export const TRIAL_QUESTIONS = 3;
export const PASS_MARK = 2;
export const SECONDS_PER_QUESTION = 30;
const GRACE_MS = 5_000;
const OPTIONS = 4;

const QuestionSchema = z.object({
  question: z.string().trim().min(5).max(220),
  options: z.array(z.string().trim().min(1).max(100)).length(OPTIONS),
  answerIndex: z.number().int().min(0).max(OPTIONS - 1),
});
const TrialSchema = z.object({ questions: z.array(z.unknown()) });

const SYSTEM = `You check whether someone actually read a text. Write exactly ${TRIAL_QUESTIONS} multiple-choice questions about
its CONTENT (events, arguments, characters, definitions) that a reader would know and a non-reader would not.
Each has exactly ${OPTIONS} options and one correct answer (answerIndex 0-based). No questions about the title or author.
Respond with JSON: {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0}]}`;

interface Trial {
  questions: z.infer<typeof QuestionSchema>[];
  deadline: number;
}

const globalForTrials = globalThis as typeof globalThis & { __awakenReadingTrials?: Map<string, Trial> };
function trials(): Map<string, Trial> {
  globalForTrials.__awakenReadingTrials ??= new Map();
  return globalForTrials.__awakenReadingTrials;
}

function requireReadyReadVow(playerId: string, questId: string) {
  const quest = getQuest(questId);
  if (!quest || quest.playerId !== playerId) throw new QuestError(`No vow ${questId} for ${playerId}`, 404);
  if (quest.type !== 'read') throw new QuestError(`Vow ${questId} is not a reading vow`, 400);
  if (quest.status !== 'active') throw new QuestError(`Vow ${questId} is already ${quest.status}`, 409);
  if (quest.progress < quest.target) throw new QuestError('Finish the reading time in the Phone Jail first', 409);
  return quest;
}

export interface PublicTrial {
  questions: { question: string; options: string[] }[];
  secondsPerQuestion: number;
  deadline: string;
}

export async function startReadingTrial(playerId: string, questId: string, now = Date.now()): Promise<PublicTrial> {
  const quest = requireReadyReadVow(playerId, questId);
  let trial = trials().get(questId);
  if (!trial) {
    const raw = await geminiJson({ system: SYSTEM, prompt: `The person just read: ${quest.topic ?? quest.title}.`, timeoutMs: 12_000 }, TrialSchema);
    const questions = (raw?.questions ?? []).flatMap((q) => {
      const parsed = QuestionSchema.safeParse(q);
      return parsed.success ? [parsed.data] : [];
    });
    if (questions.length < TRIAL_QUESTIONS) throw new QuestError('Iris could not write the trial right now. Try again in a moment.', 409);
    // An overlapping start may have stored a trial while we waited: first one wins, so the screen and the grader agree.
    trial = trials().get(questId) ?? { questions: questions.slice(0, TRIAL_QUESTIONS), deadline: now + TRIAL_QUESTIONS * SECONDS_PER_QUESTION * 1_000 };
    trials().set(questId, trial);
  }
  return {
    questions: trial.questions.map(({ question, options }) => ({ question, options })),
    secondsPerQuestion: SECONDS_PER_QUESTION,
    deadline: new Date(trial.deadline).toISOString(),
  };
}

export interface TrialResult {
  correct: number;
  passed: boolean;
  late: boolean;
  answers: number[];
  completion: CompletionResult | null;
}

export async function answerReadingTrial(playerId: string, questId: string, answers: readonly number[], now = Date.now()): Promise<TrialResult> {
  requireReadyReadVow(playerId, questId);
  const trial = trials().get(questId);
  if (!trial) throw new QuestError('Start the reading trial first', 409);
  if (answers.length !== trial.questions.length) throw new QuestError(`Send ${trial.questions.length} answers`, 400);
  trials().delete(questId); // one attempt

  const late = now > trial.deadline + GRACE_MS;
  const correct = late ? 0 : trial.questions.filter((q, i) => q.answerIndex === answers[i]).length;
  const passed = correct >= PASS_MARK;
  const completion = passed
    ? await completeReadingVow(playerId, questId)
    : (await failQuest(playerId, questId, late ? 'Reading trial answered too late' : `Reading trial failed: ${correct}/${trial.questions.length} correct`), null);
  return { correct, passed, late, answers: trial.questions.map((q) => q.answerIndex), completion };
}

/** Forgets issued trials for these vows (demo reset). */
export function forgetReadingTrials(questIds: readonly string[]): void {
  questIds.forEach((id) => trials().delete(id));
}

/** Test hook. */
export function resetReadingTrials(): void {
  globalForTrials.__awakenReadingTrials = undefined;
}
