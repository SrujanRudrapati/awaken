/**
 * Weekly Boss report (on demand): the last 7 days of XP per stat (Tiger Data) + this week's
 * quest results, judged by Opus via lib/ai/claude.ts (Bedrock → Anthropic). Facts and numbers
 * are computed in code; Opus only writes the words. Offline → a code-written report.
 * Cached per player for a few minutes so repeated opens don't re-run Opus.
 */
import { z } from 'zod';
import { claudeJson } from '../../lib/ai/claude';
import * as db from '../../lib/db';
import { BANNED_WORDS, STAT_LABELS, containsBannedWord } from '../../lib/brand';
import { OPUS } from '../../lib/models';
import { StatSchema, type Player, type Quest, type Stat } from '../../lib/schemas';
import { QuestError, getPlayer, listQuests } from '../quests';

export const REPORT_DAYS = 7;
export const REPORT_CACHE_MS = 10 * 60_000;
/** Even `fresh` reuses a report this young (stops Opus being re-run in a loop). */
export const MIN_FRESH_MS = 30_000;
const OPUS_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const ORDERS = 3;

const ReportSchema = z.object({
  title: z.string(),
  verdict: z.string(),
  summary: z.string(),
  orders: z.array(z.string()),
});

export interface BossReport {
  title: string;
  verdict: string;
  summary: string;
  /** Exactly three orders for next week. */
  orders: string[];
}

export interface WeekFacts {
  xpByStat: Record<Stat, number>;
  totalXp: number;
  strongest: Stat | null;
  weakest: Stat;
  completed: number;
  failed: number;
  activeDays: number;
}

export interface WeeklyReport {
  playerId: string;
  generatedAt: string;
  source: 'opus' | 'fallback';
  facts: WeekFacts;
  report: BossReport;
}

const SYSTEM = `You are Iris, the Arbiter: the voice that holds one person to the vows they swore.
Write the weekly judgment. Deadpan, dry, a little judgmental; secretly proud when it is earned. No emojis, no exclamation marks.
Vocabulary: vow (not quest), Proof (not XP), Ascension (not level up), the Reckoning (failure). Stats: Body, Mind, Focus, Vitality, Discipline, Presence.
Never say ${[...BANNED_WORDS, 'system'].join(', ')}. Never mention AI, models, apps, games, anime, or any existing story. Use ONLY the facts given; invent nothing.
JSON fields: title (≤ 8 words), verdict (one sentence), summary (≤ 70 words), orders (exactly ${ORDERS} short imperative orders for next week, each ≤ 14 words, aimed at the weakest stats).`;

const globalForBoss = globalThis as typeof globalThis & { __awakenBoss?: Map<string, WeeklyReport> };
function cache(): Map<string, WeeklyReport> {
  globalForBoss.__awakenBoss ??= new Map();
  return globalForBoss.__awakenBoss;
}

/** Pure: the week's numbers from XP history + quests. */
export function weekFacts(history: readonly db.StatHistoryRow[], quests: readonly Quest[], now = new Date()): WeekFacts {
  const xpByStat = Object.fromEntries(StatSchema.options.map((s) => [s, 0])) as Record<Stat, number>;
  for (const row of history) xpByStat[row.stat] += row.xp;
  const ranked = [...StatSchema.options].sort((a, b) => xpByStat[b] - xpByStat[a]);
  const totalXp = ranked.reduce((sum, s) => sum + xpByStat[s], 0);
  const since = now.getTime() - REPORT_DAYS * DAY_MS;
  const thisWeek = quests.filter((q) => new Date(q.deadline).getTime() >= since);
  return {
    xpByStat,
    totalXp,
    strongest: totalXp > 0 ? ranked[0] : null,
    weakest: ranked[ranked.length - 1],
    completed: thisWeek.filter((q) => q.status === 'done').length,
    failed: thisWeek.filter((q) => q.status === 'failed').length,
    activeDays: new Set(history.filter((r) => r.xp > 0).map((r) => r.day)).size,
  };
}

function describe(player: Player, facts: WeekFacts): string {
  const xp = StatSchema.options.map((s) => `${STAT_LABELS[s]} ${facts.xpByStat[s]}`).join(', ');
  return [
    `Rank ${player.rank}, level ${player.level}${player.penalty ? ', currently in the Reckoning' : ''}.`,
    `Proof earned in the last ${REPORT_DAYS} days by stat: ${xp} (total ${facts.totalXp}).`,
    `Active days: ${facts.activeDays}/${REPORT_DAYS}. Vows kept: ${facts.completed}. Vows broken: ${facts.failed}.`,
    `Strongest stat: ${facts.strongest ? STAT_LABELS[facts.strongest] : 'none'}. Weakest stat: ${STAT_LABELS[facts.weakest]}.`,
  ].join('\n');
}

/** Strict check on Opus output; null if it broke the format. */
export function validateReport(raw: z.infer<typeof ReportSchema> | null): BossReport | null {
  if (!raw) return null;
  const clean = (s: string, max: number) => s.trim().replace(/!/g, '.').slice(0, max);
  const orders = raw.orders.map((o) => clean(o, 120)).filter(Boolean);
  const report = { title: clean(raw.title, 80), verdict: clean(raw.verdict, 200), summary: clean(raw.summary, 600), orders };
  if (!report.title || !report.verdict || !report.summary || orders.length < ORDERS) return null;
  if ([report.title, report.verdict, report.summary, ...orders].some(containsBannedWord)) return null;
  return { ...report, orders: orders.slice(0, ORDERS) };
}

export function fallbackReport(facts: WeekFacts): BossReport {
  const idle = facts.totalXp === 0;
  const weakest = STAT_LABELS[facts.weakest];
  return {
    title: idle ? 'A Week of Silence' : 'Weekly Judgment',
    verdict: idle
      ? 'No Proof was recorded. Absence is not a strategy.'
      : `${facts.totalXp} Proof earned. ${weakest} lags behind, and I noticed.`,
    summary: `Active on ${facts.activeDays} of ${REPORT_DAYS} days. ${facts.completed} vows kept, ${facts.failed} broken.${
      facts.strongest ? ` ${STAT_LABELS[facts.strongest]} carried you.` : ''
    } ${weakest} is your weakest stat.`,
    orders: [`Train ${weakest} every day.`, 'Keep every vow before midnight.', 'Break nothing. The Reckoning is patient.'],
  };
}

/** The weekly report for a player (cached for REPORT_CACHE_MS unless `fresh`). */
export async function weeklyReport(playerId: string, options: { fresh?: boolean; now?: Date } = {}): Promise<WeeklyReport> {
  const now = options.now ?? new Date();
  const cached = cache().get(playerId);
  const age = cached ? now.getTime() - new Date(cached.generatedAt).getTime() : Infinity;
  if (cached && age < (options.fresh ? MIN_FRESH_MS : REPORT_CACHE_MS)) return cached;

  const player = await getPlayer(playerId);
  if (!player) throw new QuestError(`No one found with id ${playerId}`, 404);
  const history = await db.statHistory(playerId, REPORT_DAYS).catch(() => []);
  const facts = weekFacts(history, listQuests(playerId), now);

  const fromOpus = validateReport(
    await claudeJson(
      { model: OPUS, system: SYSTEM, prompt: describe(player, facts), maxTokens: 2_000, effort: 'medium', timeoutMs: OPUS_TIMEOUT_MS },
      ReportSchema,
    ),
  );
  const report: WeeklyReport = {
    playerId,
    generatedAt: now.toISOString(),
    source: fromOpus ? 'opus' : 'fallback',
    facts,
    report: fromOpus ?? fallbackReport(facts),
  };
  cache().set(playerId, report);
  return report;
}

/** Test hook. */
export function resetBoss(): void {
  globalForBoss.__awakenBoss = undefined;
}
