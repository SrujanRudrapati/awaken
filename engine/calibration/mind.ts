/**
 * Calibration · Mind: a 2-minute adaptive quiz. Gemini writes one pool of questions at three
 * difficulty levels up front (offline → the bank below); code picks the next question
 * (correct → harder, wrong → easier) and grades. Answers never leave the server.
 */
import { z } from 'zod';
import { geminiJson } from '../../lib/llm';

export const MIND_DURATION_MS = 120_000;
export const MAX_MIND_QUESTIONS = 8;
const PER_LEVEL = 4;
const OPTIONS = 4;

export type Level = 1 | 2 | 3;

export interface MindQuestion {
  id: string;
  level: Level;
  question: string;
  options: string[];
  answerIndex: number;
}

const QuestionSchema = z.object({
  question: z.string().trim().min(5).max(200),
  options: z.array(z.string().trim().min(1).max(80)).length(OPTIONS),
  answerIndex: z.number().int().min(0).max(OPTIONS - 1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const PoolSchema = z.object({ questions: z.array(z.unknown()) });

const SYSTEM = `You write multiple-choice questions for a short general reasoning check (not trivia about celebrities).
Write ${PER_LEVEL} questions at each level: 1 = easy, 2 = medium, 3 = hard (logic, arithmetic, vocabulary, science, geography).
Each has exactly ${OPTIONS} options and one correct answer (answerIndex 0-based). Unambiguous, answerable in 15 seconds.
Respond with JSON: {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"level":1}]}`;

const BANK: readonly Omit<MindQuestion, 'id'>[] = [
  { level: 1, question: 'What is 15 + 27?', options: ['32', '42', '41', '52'], answerIndex: 1 },
  { level: 1, question: 'Which planet is closest to the Sun?', options: ['Venus', 'Earth', 'Mercury', 'Mars'], answerIndex: 2 },
  { level: 1, question: 'Which word is the opposite of "ancient"?', options: ['Old', 'Modern', 'Large', 'Quiet'], answerIndex: 1 },
  { level: 1, question: 'How many minutes are in 2.5 hours?', options: ['120', '125', '150', '250'], answerIndex: 2 },
  { level: 2, question: 'If 3 pencils cost $1.20, how much do 7 pencils cost?', options: ['$2.40', '$2.80', '$3.20', '$2.10'], answerIndex: 1 },
  { level: 2, question: 'What gas do plants absorb from the air for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], answerIndex: 2 },
  { level: 2, question: 'Next in the sequence 2, 6, 12, 20, 30, …?', options: ['40', '42', '36', '44'], answerIndex: 1 },
  { level: 2, question: 'Which is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answerIndex: 3 },
  { level: 3, question: 'A train travels 120 km in 1 h 20 min. What is its average speed?', options: ['80 km/h', '90 km/h', '96 km/h', '100 km/h'], answerIndex: 1 },
  { level: 3, question: 'Which number is prime?', options: ['91', '87', '89', '93'], answerIndex: 2 },
  { level: 3, question: '"Ephemeral" most nearly means…', options: ['Lasting a very short time', 'Extremely large', 'Heavenly', 'Carefully planned'], answerIndex: 0 },
  { level: 3, question: 'If all bloops are razzies and some razzies are lazzies, which must be true?', options: ['All bloops are lazzies', 'Some bloops are lazzies', 'No bloops are lazzies', 'None of these must be true'], answerIndex: 3 },
];

function withIds(questions: readonly Omit<MindQuestion, 'id'>[]): MindQuestion[] {
  return questions.map((q, i) => ({ ...q, options: [...q.options], id: `m${i + 1}` }));
}

/** Keeps valid questions; null unless every level has at least 3. */
export function validatePool(raw: unknown[] | null | undefined): MindQuestion[] | null {
  const valid = (raw ?? []).flatMap((q) => {
    const parsed = QuestionSchema.safeParse(q);
    return parsed.success ? [parsed.data] : [];
  });
  const enough = ([1, 2, 3] as const).every((level) => valid.filter((q) => q.level === level).length >= 3);
  return enough ? withIds(valid) : null;
}

export async function generatePool(): Promise<MindQuestion[]> {
  const raw = await geminiJson({ system: SYSTEM, prompt: 'Write the questions.', timeoutMs: 12_000 }, PoolSchema);
  return validatePool(raw?.questions) ?? withIds(BANK);
}

/** Next unasked question at `level`, else the nearest level that still has one. */
export function nextQuestion(pool: readonly MindQuestion[], askedIds: ReadonlySet<string>, level: Level): MindQuestion | null {
  const order: Level[] = level === 1 ? [1, 2, 3] : level === 2 ? [2, 1, 3] : [3, 2, 1];
  for (const l of order) {
    const q = pool.find((p) => p.level === l && !askedIds.has(p.id));
    if (q) return q;
  }
  return null;
}

export function adapt(level: Level, correct: boolean): Level {
  return (correct ? Math.min(3, level + 1) : Math.max(1, level - 1)) as Level;
}

export function publicQuestion(q: MindQuestion): Omit<MindQuestion, 'answerIndex'> {
  return { id: q.id, level: q.level, question: q.question, options: q.options };
}
