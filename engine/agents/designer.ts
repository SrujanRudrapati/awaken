/**
 * Daily quest designer (Gemini). Picks today's quests for a player from OUR quest types only,
 * biased toward their weakest stat. Anything invalid → the fixed DAILY_TEMPLATES.
 * The model only chooses type + difficulty; targets, XP and stats stay in code (progression.ts).
 */
import { z } from 'zod';
import { geminiJson } from '../../lib/llm';
import { recall } from '../../lib/memory';
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
Favor the player's weakest stats. Respond with JSON: {"quests":[{"type":"...","difficulty":"..."}]}`;

function describe(player: Player): string {
  const stats = Object.entries(player.stats).map(([s, v]) => `${s} ${v}`).join(', ');
  const catalog = DESIGNABLE_TYPES.map((t) => `${t} (trains ${QUEST_RULES[t].stat})`).join(', ');
  return `Player rank ${player.rank}, level ${player.level}, stats: ${stats}.${player.penalty ? ' Currently in the Penalty Zone.' : ''}\nQuest catalog: ${catalog}`;
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
export const DESIGNER_RECALL_QUERY = "player's goals, failed or skipped quests, weakest stats, favorite quest types";

export function recallForDesigner(player: Player): Promise<string | null> {
  return recall(player.id, DESIGNER_RECALL_QUERY);
}

export interface DesignerOptions {
  /** Extra context (e.g. Supermemory recall) appended to the prompt. */
  context?: (player: Player) => Promise<string | null>;
}

export function createGeminiDesigner(options: DesignerOptions = {}): QuestDesigner {
  return async (player) => {
    const extra = (await options.context?.(player).catch(() => null)) ?? null;
    const prompt = extra ? `${describe(player)}\nWhat the System remembers: ${extra}` : describe(player);
    return validateDesign(await geminiJson({ system: SYSTEM, prompt }, DesignSchema)) ?? DAILY_TEMPLATES;
  };
}
