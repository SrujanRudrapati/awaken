/**
 * Apple Watch sleep → nights → vows → Iris's morning summary.
 *
 *   samples (Shortcut) → sleepStore (dedupe) → summarizeNights → for each active night vow,
 *   the night it is about (nightOfVow) decides it:
 *     lightsoutby  asleep by HH:MM → kept (+ bonus if the Home Base saw a dark room ±15 min), else broken
 *     bedtime      asleep within ±30 min of HH:MM → kept, else broken
 *     sleep        asleep ≥ target hours → kept (+ bonus for deep minutes above personal baseline);
 *                  otherwise progress is recorded and the vow stays open until its deadline
 *   then, once per night, a `sleep.summary` event + a sleepy Iris line about it.
 * Deterministic: the LLM only writes the sentence.
 */
import { publish } from '../lib/bus';
import * as db from '../lib/db';
import { wasDarkNear } from '../lib/homebaseLight';
import type { NightSummary, Quest, SleepSample } from '../lib/schemas';
import { addSleepSamples, listSleepSamples } from '../lib/sleepStore';
import { stripTags } from '../lib/voice/tags';
import { composeLine, sayLine } from './agents/voice';
import { DEFAULT_TARGET_TIME, nightOfVow } from './progression';
import { QuestError, completeQuest, failQuest, getPlayer, listQuests, setQuestProgress } from './quests';
import { bedtimeKept, clockTime, deepBaseline, deepBonus, hoursText, lightsOutKept, nightFacts, summarizeNights } from './sleep';

export const SLEEP_HISTORY_DAYS = 30;
/** Extra Proof when the room's light sensor agrees the lights really went out. */
export const LIGHT_CONFIRM_BONUS = 10;
const DAY_MS = 24 * 60 * 60_000;

export interface VowVerdict {
  questId: string;
  type: Quest['type'];
  kept: boolean | null; // null = not decided yet (sleep target not reached)
  bonusXp: number;
  detail: string;
}

export interface SleepSyncResult {
  added: number;
  lastNight: NightSummary | null;
  verdicts: VowVerdict[];
  announced: boolean;
}

const globalForSleepSync = globalThis as typeof globalThis & { __awakenAnnouncedNights?: Set<string> };
function announced(): Set<string> {
  globalForSleepSync.__awakenAnnouncedNights ??= new Set();
  return globalForSleepSync.__awakenAnnouncedNights;
}

/** Pure: what one night means for one vow. */
export function judgeVow(quest: Quest, night: NightSummary, previous: readonly NightSummary[], roomDark: boolean): VowVerdict {
  const target = quest.targetTime ?? DEFAULT_TARGET_TIME;
  const asleepAt = clockTime(night.bedtime);
  if (quest.type === 'lightsoutby') {
    const kept = lightsOutKept(night, target);
    return {
      questId: quest.id,
      type: quest.type,
      kept,
      bonusXp: kept && roomDark ? LIGHT_CONFIRM_BONUS : 0,
      detail: kept ? `Asleep at ${asleepAt}, before ${target}${roomDark ? ' (room confirmed dark)' : ''}.` : `Asleep at ${asleepAt}, after your ${target} vow.`,
    };
  }
  if (quest.type === 'bedtime') {
    const kept = bedtimeKept(night, target);
    return { questId: quest.id, type: quest.type, kept, bonusXp: 0, detail: `Asleep at ${asleepAt}; target ${target} ± 30 min.` };
  }
  const hours = night.asleepMinutes / 60;
  const kept = hours >= quest.target ? true : null;
  const bonus = kept ? deepBonus(night, deepBaseline(previous)) : 0;
  return {
    questId: quest.id,
    type: quest.type,
    kept,
    bonusXp: bonus,
    detail: `${hoursText(night.asleepMinutes)} asleep of ${quest.target} h${bonus ? `, +${bonus} Proof for deep sleep above your baseline` : ''}.`,
  };
}

async function applyVerdict(playerId: string, quest: Quest, verdict: VowVerdict, night: NightSummary): Promise<void> {
  try {
    if (verdict.kept === true) await completeQuest(playerId, quest.id, { bonusXp: verdict.bonusXp });
    else if (verdict.kept === false) await failQuest(playerId, quest.id, verdict.detail);
    else await setQuestProgress(playerId, quest.id, Math.round((night.asleepMinutes / 60) * 10) / 10);
  } catch (error) {
    if (!(error instanceof QuestError)) throw error; // finished concurrently: skip
  }
}

function logNight(playerId: string, night: NightSummary): void {
  db.logEvent({ playerId, kind: 'sleep.night', stat: 'VIT', value: night.asleepMinutes, verified: true, source: 'health', detail: { ...night } });
}

async function announce(playerId: string, night: NightSummary, verdicts: readonly VowVerdict[]): Promise<void> {
  const outcomes = verdicts.filter((v) => v.kept !== null).map((v) => `${v.kept ? 'Kept' : 'Broke'} a ${v.type} vow: ${v.detail}`);
  const moment = { type: 'sleep' as const, playerId, facts: [nightFacts(night), ...outcomes].join(' ') };
  const tagged = await composeLine(moment);
  publish({ type: 'sleep.summary', playerId, summary: night, line: stripTags(tagged), irisMood: 'sleepy' });
  await sayLine(moment, tagged);
}

export async function syncSleep(playerId: string, samples: readonly SleepSample[], now = new Date()): Promise<SleepSyncResult> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  const added = addSleepSamples(playerId, samples);
  const nights = summarizeNights(await listSleepSamples(playerId, new Date(now.getTime() - SLEEP_HISTORY_DAYS * DAY_MS)));
  const lastNight = nights[0] ?? null;
  if (!lastNight) return { added, lastNight, verdicts: [], announced: false };

  const verdicts: VowVerdict[] = [];
  const open = listQuests(playerId).filter((q) => q.status === 'active' && ['lightsoutby', 'bedtime', 'sleep'].includes(q.type));
  for (const quest of open) {
    const night = nights.find((n) => n.night === nightOfVow(quest.deadline));
    if (!night) continue;
    const previous = nights.filter((n) => n.night < night.night);
    const verdict = judgeVow(quest, night, previous, wasDarkNear(new Date(night.bedtime)));
    verdicts.push(verdict);
    await applyVerdict(playerId, quest, verdict, night);
  }

  const key = `${playerId}|${lastNight.night}`;
  const isNew = !announced().has(key);
  if (isNew) {
    announced().add(key);
    logNight(playerId, lastNight);
    await announce(playerId, lastNight, verdicts);
  }
  return { added, lastNight, verdicts, announced: isNew };
}

/** Nights for GET /api/sleep (newest first). */
export async function recentNights(playerId: string, days: number, now = new Date()): Promise<NightSummary[]> {
  const since = new Date(now.getTime() - (days + 1) * DAY_MS);
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return summarizeNights(await listSleepSamples(playerId, since)).filter((n) => new Date(n.wake) >= cutoff);
}

/** Last night's summary for the designer (null if none in the last ~36 h). */
export async function lastNightFor(playerId: string, now = new Date()): Promise<NightSummary | null> {
  const [latest] = await recentNights(playerId, 2, now);
  return latest && now.getTime() - new Date(latest.wake).getTime() < 1.5 * DAY_MS ? latest : null;
}

/** Test hook. */
export function resetSleepSync(): void {
  globalForSleepSync.__awakenAnnouncedNights = undefined;
}
