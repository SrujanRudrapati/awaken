/**
 * Nine mixed demo profiles placed just above the demo person on this week's board, so a live
 * vow on stage visibly passes someone (rank.passed). Original names; ids are `demo-seed-*`
 * (removed by `npm run demo:reset`).
 */
import { zeroProof, type StatProof } from '../../lib/power';
import { createPlayer, getPlayer, seedDemoPlayer, weeklyProofOf, type SeedProfile } from '../quests';

interface Archetype {
  slug: string;
  name: string;
  label: string;
  /** Lifetime Proof per stat. */
  proof: Partial<StatProof>;
}

export const ARCHETYPES: readonly Archetype[] = [
  { slug: 'reader', name: 'Wren', label: 'reader', proof: { INT: 520, FOCUS: 260, DISCIPLINE: 90 } },
  { slug: 'runner', name: 'Tomas', label: 'runner', proof: { VIT: 610, STR: 140, DISCIPLINE: 120 } },
  { slug: 'student', name: 'Priya', label: 'student', proof: { INT: 330, FOCUS: 300, CHA: 60 } },
  { slug: 'retiree', name: 'Hal', label: 'retiree', proof: { VIT: 280, DISCIPLINE: 340, CHA: 150, STR: 60, INT: 120, FOCUS: 100 } }, // balanced → C
  { slug: 'lifter', name: 'Dana', label: 'lifter', proof: { STR: 700, VIT: 160 } },
  { slug: 'nightnurse', name: 'Ines', label: 'night-shift nurse', proof: { VIT: 300, DISCIPLINE: 260, CHA: 120, FOCUS: 80, STR: 50, INT: 50 } }, // C
  { slug: 'meditator', name: 'Kenji', label: 'meditator', proof: { FOCUS: 480, DISCIPLINE: 200, INT: 90, VIT: 40, STR: 30, CHA: 30 } }, // C
  { slug: 'parent', name: 'Marisol', label: 'parent of twins', proof: { DISCIPLINE: 120, CHA: 90, VIT: 40 } }, // just starting → E
  { slug: 'climber', name: 'Bo', label: 'climber', proof: { STR: 380, CHA: 180, VIT: 160, FOCUS: 60 } },
];

/** Weekly Proof steps above the demo person (closest first, so the first pass comes quickly). */
export const WEEKLY_STEPS = [8, 18, 30, 45, 60, 80, 105, 135, 170] as const;

export interface SeededRow {
  id: string;
  name: string;
  label: string;
  weeklyProof: number;
}

export async function seedOthers(demoPlayerId: string): Promise<{ base: number; seeded: SeededRow[] }> {
  if (!(await getPlayer(demoPlayerId))) await createPlayer({ id: demoPlayerId, name: 'Demo' });
  const base = weeklyProofOf(demoPlayerId);
  const seeded = ARCHETYPES.map((a, i) => {
    const profile: SeedProfile = {
      id: `demo-seed-${a.slug}`,
      name: a.name,
      proof: { ...zeroProof(), ...a.proof },
      weeklyProof: base + WEEKLY_STEPS[i],
    };
    seedDemoPlayer(profile);
    return { id: profile.id, name: a.name, label: a.label, weeklyProof: profile.weeklyProof };
  });
  return { base, seeded };
}
