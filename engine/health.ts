/**
 * Apple Health sync: totals from the iPhone Shortcut → Tiger events + progress on the
 * player's run / steps / workout / sleep quests. A quest whose metric reaches its target
 * completes through the engine (XP, level-up, display, ntfy). Deterministic: plain comparisons.
 */
import { publish } from '../lib/bus';
import * as db from '../lib/db';
import type { HealthSync, Quest, QuestType } from '../lib/schemas';
import { QuestError, completeQuest, getPlayer, listQuests, setQuestProgress } from './quests';

type HealthMetric = 'steps' | 'distanceKm' | 'activeKcal' | 'workoutMinutes' | 'sleepHours' | 'avgHeartRate';

/** Which Health total counts toward which quest type (same unit as QUEST_RULES targets). */
export const HEALTH_QUEST_METRIC: Partial<Record<QuestType, HealthMetric>> = {
  run: 'distanceKm',
  steps: 'steps',
  workout: 'workoutMinutes',
  sleep: 'sleepHours',
};

const LOGGED_METRICS: readonly HealthMetric[] = ['steps', 'distanceKm', 'activeKcal', 'workoutMinutes', 'sleepHours', 'avgHeartRate'];

export interface HealthSyncResult {
  completed: Quest[];
  progressed: Quest[];
  leveledUp: boolean;
}

function logMetrics(playerId: string, metrics: HealthSync): void {
  for (const metric of LOGGED_METRICS) {
    const value = metrics[metric];
    if (value === undefined) continue;
    db.logEvent({ playerId, kind: `health.${metric}`, value, verified: true, source: 'health' });
  }
}

function voiceLine(result: HealthSyncResult): string {
  if (result.completed.length > 0) return 'Health data verified. Vow kept.';
  if (result.progressed.length > 0) return 'Health data synchronized. Keep moving.';
  return 'Health data synchronized.';
}

export async function syncHealth(playerId: string, metrics: HealthSync, now = new Date()): Promise<HealthSyncResult> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  logMetrics(playerId, metrics);

  const result: HealthSyncResult = { completed: [], progressed: [], leveledUp: false };
  const candidates = listQuests(playerId).filter(
    (q) => q.status === 'active' && HEALTH_QUEST_METRIC[q.type] && new Date(q.deadline) >= now,
  );
  for (const quest of candidates) {
    const value = metrics[HEALTH_QUEST_METRIC[quest.type] as HealthMetric];
    if (value === undefined) continue;
    try {
      if (value >= quest.target) {
        const done = await completeQuest(playerId, quest.id);
        result.completed.push(done.quest);
        result.leveledUp ||= done.leveledUp;
      } else if (value > quest.progress) {
        result.progressed.push(await setQuestProgress(playerId, quest.id, value));
      }
    } catch (error) {
      if (!(error instanceof QuestError)) throw error; // finished concurrently: skip it
    }
  }

  publish({ type: 'voice', text: voiceLine(result), eventType: 'health.sync', playerId });
  return result;
}
