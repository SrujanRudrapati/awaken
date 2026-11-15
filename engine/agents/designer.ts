/**
 * Daily quest designer (Gemini). Picks today's quests for a player from OUR quest types only,
 * biased toward their weakest stat. Anything invalid → the fixed DAILY_TEMPLATES.
 * The model only chooses type + difficulty; targets, XP and stats stay in code (progression.ts).
 */
import { z } from 'zod';
import { geminiJson } from '../../lib/llm';
import { recall } from '../../lib/memory';
import type { NightSummary } from '../../lib/schemas';
import { nightFacts } from '../sleep';
import { DifficultySchema, QuestTypeSchema, type Player, type QuestType } from '../../lib/schemas';
import { DAILY_TEMPLATES, QUEST_RULES, type QuestTemplate } from '../progression';
import type { QuestDesigner } from '../quests';

export const MIN_DAILY = 3;
export const MAX_DAILY = 6;

/** Types a daily can use (gates come from TinyFish, photo needs a subject; both excluded). */
export const DESIGNABLE_TYPES = QuestTypeSchema.options.filter((t): t is QuestType => t !== 'gate' && t !== 'photo');

const DesignSchema = z.object({
  quests: z.array(z.object({ type: z.string(), difficulty: z.string() })),
});

const SYSTEM = `You design a person's daily training quests for a fitness/discipline game.
Choose ${MIN_DAILY}-${MAX_DAILY} quests. Use ONLY these types: ${DESIGNABLE_TYPES.join(', ')}.
Difficulty is one of: easy, normal, hard. No duplicate types. Mix body and mind.
Favor the person's weakest stats. Respond with JSON: {"quests":[{"type":"...","difficulty":"..."}]}`;

function describe(player: Player): string {
  const stats = Object.entries(player.stats).map(([s, v]) => `${s} ${v}`).join(', ');
  const catalog = DESIGNABLE_TYPES.map((t) => `${t} (trains ${QUEST_RULES[t].stat})`).join(', ');
  return `Rank ${player.rank}, level ${player.level}, stats: ${stats}.${player.penalty ? ' Currently in the Reckoning.' : ''}\nQuest catalog: ${catalog}`;
}

/** Keeps only valid, unique, designable templates; null if too few survive. */
export function validateDesign(raw: z.infer<typeof DesignSchema> | null): QuestTemplate[] | null {
  if (!raw) return null;
  const seen = new Set<QuestType>();
  const templates = raw.quests.flatMap((q) => {
    const type = QuestTypeSchema.safeParse(q.type);
    const difficulty = DifficultySchema.safeParse(q.difficulty);
    if (!type.success || !difficulty.success || !DESIGNABLE_TYPES.includes(type.data) || seen.has(type.data)) return [];
    seen.add(type.data);
    return [{ type: type.data, difficulty: difficulty.data }];
  });
  return templates.length >= MIN_DAILY ? templates.slice(0, MAX_DAILY) : null;
}

/** What the designer asks Supermemory before planning a player's day. */
export const DESIGNER_RECALL_QUERY = 'goals, broken or skipped vows, weakest stats, favorite vow types';

export function recallForDesigner(player: Player): Promise<string | null> {
  return recall(player.id, DESIGNER_RECALL_QUERY);
}

export interface DesignerOptions {
  /** Extra context (e.g. Supermemory recall) appended to the prompt. */
  context?: (player: Player) => Promise<string | null>;
  /** Last night from the Watch (null if unknown). Short sleep → lighter Body vows + a lights-out vow. */
  sleep?: (player: Player) => Promise<NightSummary | null>;
}

/** Under this much sleep the day is designed lighter. */
export const SHORT_SLEEP_MINUTES = 6 * 60;
const BODY_TYPES: readonly QuestType[] = DESIGNABLE_TYPES.filter((t) => QUEST_RULES[t].stat === 'STR');

/** Deterministic: after a short night, Body vows drop to easy and a lights-out vow is guaranteed. */
export function adjustForSleep(templates: readonly QuestTemplate[], night: NightSummary | null): readonly QuestTemplate[] {
  if (!night || night.asleepMinutes >= SHORT_SLEEP_MINUTES) return templates;
  const lighter = templates.map((t) => (BODY_TYPES.includes(t.type) ? { ...t, difficulty: 'easy' as const } : t));
  if (lighter.some((t) => t.type === 'lightsoutby')) return lighter;
  const lightsOut: QuestTemplate = { type: 'lightsoutby', difficulty: 'normal' };
  return lighter.length >= MAX_DAILY ? [...lighter.slice(0, MAX_DAILY - 1), lightsOut] : [...lighter, lightsOut];
}

export function createGeminiDesigner(options: DesignerOptions = {}): QuestDesigner {
  return async (player) => {
    const [extra, night] = await Promise.all([
      options.context?.(player).catch(() => null) ?? null,
      options.sleep?.(player).catch(() => null) ?? null,
    ]);
    const parts = [describe(player)];
    if (extra) parts.push(`What Iris remembers: ${extra}`);
    if (night) {
      const short = night.asleepMinutes < SHORT_SLEEP_MINUTES;
      parts.push(`${nightFacts(night)}${short ? ' That is short: keep Body vows light and include a lightsoutby vow.' : ''}`);
    }
    const designed = validateDesign(await geminiJson({ system: SYSTEM, prompt: parts.join('\n') }, DesignSchema)) ?? DAILY_TEMPLATES;
    return adjustForSleep(designed, night ?? null);
  };
}
