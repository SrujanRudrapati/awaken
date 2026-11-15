/**
 * Constellations — leagues of ~30 people with similar Power, recomputed on read (so new people
 * slot in immediately). Inside a Constellation, this week's verified Proof decides the order.
 */
import * as db from '../lib/db';
import { power, proofOf } from '../lib/power';
import type { Player, Rank } from '../lib/schemas';
import { weeklyProof } from './ledger';
import { QuestError, getPlayer, listPlayersInMemory } from './quests';

export const CONSTELLATION_SIZE = 30;
export const CONSTELLATION_NAMES = [
  'Lyra', 'Orion', 'Cygnus', 'Vela', 'Carina', 'Draco', 'Aquila', 'Pavo', 'Lupus', 'Corvus',
  'Cetus', 'Hydra', 'Phoenix', 'Grus', 'Norma', 'Volans', 'Tucana', 'Pictor', 'Musca', 'Fornax',
] as const;

export interface ConstellationMember {
  id: string;
  name: string;
  rank: Rank;
  power: number;
  weeklyProof: number;
}

export interface Constellation {
  name: string;
  index: number;
  size: number;
  position: number;
  members: ConstellationMember[];
}

/** Everyone known (memory is fresher than Tiger), strongest first. */
async function everyone(): Promise<Player[]> {
  const byId = new Map<string, Player>();
  const stored = await Promise.resolve()
    .then(() => db.listPlayers(1_000))
    .catch(() => [] as Player[]);
  stored.forEach((p) => byId.set(p.id, p));
  listPlayersInMemory().forEach((p) => byId.set(p.id, p));
  return [...byId.values()].sort((a, b) => power(proofOf(b)) - power(proofOf(a)) || a.id.localeCompare(b.id));
}

/** Pure: groups of CONSTELLATION_SIZE by Power; a small tail joins the previous group. */
export function group<T>(sorted: readonly T[], size = CONSTELLATION_SIZE): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < sorted.length; i += size) groups.push(sorted.slice(i, i + size));
  const last = groups.at(-1);
  if (groups.length > 1 && last && last.length < size / 2) groups[groups.length - 2].push(...(groups.pop() ?? []));
  return groups;
}

export async function constellationOf(playerId: string): Promise<Constellation> {
  if (!(await getPlayer(playerId))) throw new QuestError(`No one found with id ${playerId}`, 404);
  const groups = group(await everyone());
  const index = Math.max(0, groups.findIndex((g) => g.some((p) => p.id === playerId)));
  const members = (groups[index] ?? [])
    .map((p) => ({ id: p.id, name: p.name, rank: p.rank, power: power(proofOf(p)), weeklyProof: weeklyProof(p.id) }))
    .sort((a, b) => b.weeklyProof - a.weeklyProof || b.power - a.power);
  return {
    name: CONSTELLATION_NAMES[index % CONSTELLATION_NAMES.length],
    index,
    size: members.length,
    position: members.findIndex((m) => m.id === playerId) + 1,
    members,
  };
}
