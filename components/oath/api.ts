/** Typed, validated browser calls to the OATH API (FRONTEND_CONTRACT.md). Server `error` strings are shown as-is. */
import { z } from 'zod';
import { NightSummarySchema, PlayerSchema, QuestSchema, RankSchema, StatSchema, type Quest, type QuestType } from '../../lib/schemas';

const EnvelopeSchema = z.object({ success: z.boolean(), data: z.unknown(), error: z.string().nullable() });

export async function oathCall<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers = isForm ? init?.headers : { 'content-type': 'application/json', ...init?.headers };
  const res = await fetch(url, { ...init, headers });
  const envelope = EnvelopeSchema.safeParse(await res.json().catch(() => null));
  if (!envelope.success) throw new Error('Iris sent something unreadable. Try again.');
  if (!envelope.data.success) throw new Error(envelope.data.error ?? 'Request failed');
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) throw new Error('Iris sent something unreadable. Try again.');
  return data.data;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const id = (value: string): string => encodeURIComponent(value);

// ── vows ────────────────────────────────────────────────────────────────────
const QuestEnvelope = z.object({ quest: QuestSchema });

export type NewVow = { type: QuestType; title?: string; topic?: string; targetTime?: string; difficulty?: 'easy' | 'normal' | 'hard' };

export async function startVow(personId: string, input: { questId: string } | NewVow): Promise<Quest> {
  return (await oathCall('/api/quest/start', QuestEnvelope, post({ playerId: personId, ...input }))).quest;
}

export async function startUrgentVow(personId: string, type: QuestType): Promise<Quest> {
  return (await oathCall('/api/quest/emergency', QuestEnvelope, post({ playerId: personId, type }))).quest;
}

const PhotoResultSchema = z.object({ passed: z.boolean(), confidence: z.number(), reason: z.string(), xpGained: z.number().optional(), leveledUp: z.boolean().optional() });
export type PhotoResult = z.infer<typeof PhotoResultSchema>;

export function submitPhoto(personId: string, questId: string, photo: File): Promise<PhotoResult> {
  const form = new FormData();
  form.set('playerId', personId);
  form.set('questId', questId);
  form.set('photo', photo);
  return oathCall('/api/photo', PhotoResultSchema, { method: 'POST', body: form });
}

const QuestionSchema = z.object({ question: z.string(), options: z.array(z.string()).min(2) });
export type TrialQuestion = z.infer<typeof QuestionSchema>;
const TrialSchema = z.object({ questions: z.array(QuestionSchema).min(1), secondsPerQuestion: z.number().optional(), deadline: z.string().optional() });
export type Trial = z.infer<typeof TrialSchema>;
const TrialResultSchema = z.object({ correct: z.number(), passed: z.boolean(), answers: z.array(z.number()), xpGained: z.number().optional(), late: z.boolean().optional() });
export type TrialResult = z.infer<typeof TrialResultSchema>;

export const fetchQuizTrial = (personId: string, questId: string, topic: string): Promise<Trial> =>
  oathCall('/api/quiz', TrialSchema, post({ playerId: personId, questId, topic }));
export const answerQuizTrial = (personId: string, questId: string, answers: number[]): Promise<TrialResult> =>
  oathCall('/api/quiz/answer', TrialResultSchema, post({ playerId: personId, questId, answers }));
export const fetchReadTrial = (personId: string, questId: string): Promise<Trial> =>
  oathCall('/api/read/trial', TrialSchema, post({ playerId: personId, questId }));
export const answerReadTrial = (personId: string, questId: string, answers: number[]): Promise<TrialResult> =>
  oathCall('/api/read/answer', TrialResultSchema, post({ playerId: personId, questId, answers }));

// ── people, rank, board ─────────────────────────────────────────────────────
const HistorySchema = z.object({
  player: PlayerSchema,
  history: z.array(z.object({ day: z.string(), stat: StatSchema, xp: z.number() })),
});
export type PersonHistory = z.infer<typeof HistorySchema>;
export const fetchHistory = (personId: string): Promise<PersonHistory> => oathCall(`/api/player/${id(personId)}`, HistorySchema);

export async function swear(name: string): Promise<z.infer<typeof PlayerSchema>> {
  return (await oathCall('/api/player', z.object({ player: PlayerSchema }), post({ name }))).player;
}

const BoardRowSchema = z.object({ id: z.string(), name: z.string(), rank: RankSchema, level: z.number().optional(), power: z.number(), weeklyProof: z.number() });
export type BoardRow = z.infer<typeof BoardRowSchema>;
const LeaderboardSchema = z.object({ week: z.string(), players: z.array(BoardRowSchema) });
export const fetchLeaderboard = (): Promise<z.infer<typeof LeaderboardSchema>> => oathCall('/api/leaderboard?includeDemo=1', LeaderboardSchema);

const ConstellationSchema = z.object({ name: z.string(), size: z.number(), position: z.number(), members: z.array(BoardRowSchema) });
export type Constellation = z.infer<typeof ConstellationSchema>;
export const fetchConstellation = (personId: string): Promise<Constellation> => oathCall(`/api/constellation/${id(personId)}`, ConstellationSchema);

const WalletSchema = z.object({ balance: z.number(), earned: z.number(), shields: z.number(), cosmetics: z.array(z.string()), lastHalveAt: z.string().nullable() });
const ShardsSchema = z.object({
  wallet: WalletSchema,
  prices: z.object({ shield: z.number(), halve: z.number(), bonus: z.number() }),
  catalog: z.array(z.object({ id: z.string(), name: z.string(), cost: z.number() })),
});
export type Shards = z.infer<typeof ShardsSchema>;
export const fetchShards = (personId: string): Promise<Shards> => oathCall(`/api/shards/${id(personId)}`, ShardsSchema);

export type ShardSpend = { item: 'shield' } | { item: 'bonus' } | { item: 'halve'; questId: string } | { item: 'cosmetic'; cosmeticId: string };
const SpendSchema = z.object({ wallet: WalletSchema, detail: z.unknown().optional() });
export const spendShards = (personId: string, spend: ShardSpend): Promise<z.infer<typeof SpendSchema>> =>
  oathCall('/api/shards/spend', SpendSchema, post({ playerId: personId, ...spend }));

const ReportSchema = z.object({
  source: z.string(),
  report: z.object({ title: z.string(), verdict: z.string(), summary: z.string(), orders: z.array(z.string()) }),
});
export type WeekReport = z.infer<typeof ReportSchema>;
export const fetchReport = (personId: string): Promise<WeekReport> => oathCall(`/api/report/${id(personId)}`, ReportSchema);

const SleepSchema = z.object({ nights: z.array(NightSummarySchema) });
export async function fetchLastNight(personId: string): Promise<z.infer<typeof NightSummarySchema> | null> {
  return (await oathCall(`/api/sleep?playerId=${id(personId)}&days=2`, SleepSchema)).nights[0] ?? null;
}
