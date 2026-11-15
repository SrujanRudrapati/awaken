/**
 * Shards — earn-only (1 per 10 Proof kept, +20 per Ascension; see engine/quests.ts). Spend:
 *   shield    200  absorbs the next midnight's missed vows (no Reckoning). Hold at most 3.
 *   halve     300  halves an active Reckoning vow's target. At most once per 7 days.
 *   bonus     150  an extra vow worth 1.5× Proof.
 *   cosmetic  100–500  one of the CATALOG items, once each.
 */
import * as db from '../lib/db';
import { loadWallet, spendShards, type Wallet } from '../lib/wallet';
import { QuestError, addBonusVow, getPlayer, getQuest, retargetQuest } from './quests';

export const PRICES = { shield: 200, halve: 300, bonus: 150 } as const;
export const MAX_SHIELDS = 3;
const HALVE_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

export const CATALOG = [
  { id: 'frame-ember', name: 'Ember frame', cost: 100 },
  { id: 'title-unbroken', name: 'Title: The Unbroken', cost: 200 },
  { id: 'aura-starlight', name: 'Starlight aura', cost: 300 },
  { id: 'sigil-iris', name: "Iris's sigil", cost: 500 },
] as const;

export type SpendInput =
  | { item: 'shield' }
  | { item: 'bonus' }
  | { item: 'halve'; questId: string }
  | { item: 'cosmetic'; cosmeticId: string };

export interface SpendResult {
  wallet: Wallet;
  detail: Record<string, unknown>;
}

function insufficient(cost: number, wallet: Wallet): never {
  throw new QuestError(`Not enough Shards: ${cost} needed, ${wallet.balance} held`, 409);
}

export async function walletFor(playerId: string): Promise<{ wallet: Wallet; prices: typeof PRICES; catalog: typeof CATALOG }> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  return { wallet: await loadWallet(playerId), prices: PRICES, catalog: CATALOG };
}

export async function spend(playerId: string, input: SpendInput, now = Date.now()): Promise<SpendResult> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  const wallet = await loadWallet(playerId);
  let result: SpendResult;

  if (input.item === 'shield') {
    if (wallet.shields >= MAX_SHIELDS) throw new QuestError(`You already hold ${MAX_SHIELDS} shields`, 409);
    const next = spendShards(playerId, PRICES.shield, (w) => ({ ...w, shields: w.shields + 1 })) ?? insufficient(PRICES.shield, wallet);
    result = { wallet: next, detail: { shields: next.shields } };
  } else if (input.item === 'halve') {
    const quest = getQuest(input.questId);
    if (!quest || quest.playerId !== playerId || quest.status !== 'active' || quest.kind !== 'penalty') {
      throw new QuestError('Only an active Reckoning vow can be halved', 400);
    }
    if (wallet.lastHalveAt && now - new Date(wallet.lastHalveAt).getTime() < HALVE_COOLDOWN_MS) {
      throw new QuestError('The Reckoning can be halved once a week', 409);
    }
    const next = spendShards(playerId, PRICES.halve, (w) => ({ ...w, lastHalveAt: new Date(now).toISOString() })) ?? insufficient(PRICES.halve, wallet);
    const halved = retargetQuest(playerId, quest.id, Math.ceil(quest.target / 2));
    result = { wallet: next, detail: { quest: halved } };
  } else if (input.item === 'bonus') {
    const next = spendShards(playerId, PRICES.bonus) ?? insufficient(PRICES.bonus, wallet);
    result = { wallet: next, detail: { quest: await addBonusVow(playerId) } };
  } else {
    const item = CATALOG.find((c) => c.id === input.cosmeticId);
    if (!item) throw new QuestError(`Unknown cosmetic ${input.cosmeticId}`, 400);
    if (wallet.cosmetics.includes(item.id)) throw new QuestError(`You already own ${item.name}`, 409);
    const next = spendShards(playerId, item.cost, (w) => ({ ...w, cosmetics: [...w.cosmetics, item.id] })) ?? insufficient(item.cost, wallet);
    result = { wallet: next, detail: { cosmetic: item } };
  }
  db.logEvent({ playerId, kind: 'shards.spend', value: wallet.balance - result.wallet.balance, source: 'engine', detail: { item: input.item } });
  return result;
}
