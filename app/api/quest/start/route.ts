/**
 * POST /api/quest/start
 *   `{ playerId, questId }`                                 → resume an existing active quest
 *   `{ playerId, type, difficulty?, target?, title? }`      → create + start a new one
 * Sensor quests start counting immediately.
 */
import { z } from 'zod';
import { startQuest } from '../../../../engine/quests';
import { ok } from '../../../../lib/api-response';
import { QUEST_RULES } from '../../../../engine/progression';
import { DifficultySchema, QuestTypeSchema } from '../../../../lib/schemas';
import { PlayerIdSchema, errorResponse, parseJson } from '../../_lib/http';

const NewQuestSchema = z
  .object({
    playerId: PlayerIdSchema,
    type: QuestTypeSchema,
    difficulty: DifficultySchema.optional(),
    target: z.number().int().positive().max(100_000).optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  // XP is fixed per type × difficulty, so a custom target may not undercut the easy one.
  .refine((b) => b.target === undefined || b.target >= QUEST_RULES[b.type].target.easy, {
    message: 'target is below the easy target for this quest type',
    path: ['target'],
  });

const BodySchema = z.union([z.object({ playerId: PlayerIdSchema, questId: z.string().min(1) }), NewQuestSchema]);

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request, BodySchema);
  if (!body.ok) return body.response;
  const { playerId, ...input } = body.data;
  try {
    return ok({ quest: await startQuest(playerId, input) });
  } catch (error) {
    return errorResponse(error, 'quest/start');
  }
}
