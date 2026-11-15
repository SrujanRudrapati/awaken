/** Typed, validated calls from the /hunter page to the System API. Errors become thrown messages. */
import { z } from 'zod';
import { PlayerSchema, QuestSchema, type Player, type Quest, type QuestType } from '../../lib/schemas';

/** Quest types the phone armband can count (see engine/router VERIFIERS). */
export const PHONE_QUEST_TYPES = ['squat', 'pushup', 'jumpingjack', 'situp'] as const satisfies readonly QuestType[];
export type PhoneQuestType = (typeof PHONE_QUEST_TYPES)[number];

const EnvelopeSchema = z.object({ success: z.boolean(), data: z.unknown(), error: z.string().nullable() });

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const envelope = EnvelopeSchema.safeParse(await res.json().catch(() => null));
  if (!envelope.success) throw new Error(`Unexpected response from ${url}`);
  if (!envelope.data.success) throw new Error(envelope.data.error ?? 'Request failed');
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) throw new Error(`Unexpected data from ${url}`);
  return data.data;
}

const PlayerQuestsSchema = z.object({ player: PlayerSchema, quests: z.array(QuestSchema) });

export function fetchPlayerQuests(playerId: string): Promise<{ player: Player; quests: Quest[] }> {
  return call(`/api/quests/${encodeURIComponent(playerId)}`, PlayerQuestsSchema);
}

export async function createPlayer(name: string, id?: string): Promise<Player> {
  const { player } = await call('/api/player', z.object({ player: PlayerSchema }), {
    method: 'POST',
    body: JSON.stringify(id ? { name, id } : { name }),
  });
  return player;
}

export async function startQuest(playerId: string, input: { questId: string } | { type: PhoneQuestType }): Promise<Quest> {
  const { quest } = await call('/api/quest/start', z.object({ quest: QuestSchema }), {
    method: 'POST',
    body: JSON.stringify({ playerId, ...input }),
  });
  return quest;
}

/** The quest the phone should show: a running emergency first, else the newest phone-countable active quest. */
export function pickPhoneQuest(quests: readonly Quest[]): Quest | null {
  const phone = quests.filter(
    (q) => q.status === 'active' && (PHONE_QUEST_TYPES as readonly string[]).includes(q.type),
  );
  return phone.find((q) => q.kind === 'emergency') ?? phone[0] ?? null;
}

/** Inserts or replaces `quest` (immutable). */
export function upsertQuest(quests: readonly Quest[], quest: Quest): Quest[] {
  return quests.some((q) => q.id === quest.id) ? quests.map((q) => (q.id === quest.id ? quest : q)) : [quest, ...quests];
}
