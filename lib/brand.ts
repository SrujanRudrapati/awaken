/**
 * OATH — user-facing vocabulary in one place. Identifiers, DB columns, routes and SSE event
 * names keep their original names (quest, xp, player, …); only text people see or hear uses
 * these words. BANNED_WORDS must never appear in anything user-visible (enforced by tests and,
 * for model-written lines, at runtime by `containsBannedWord`).
 */
import type { Stat } from './schemas';

export const APP_NAME = 'Oath';
/** The voice that judges. */
export const ARBITER = 'Iris';
export const ARBITER_TITLE = 'the Arbiter';

export const TERMS = {
  quest: 'vow',
  quests: 'vows',
  xp: 'Proof',
  levelUp: 'Ascension',
  calibration: 'Calibration',
  reckoning: 'the Reckoning',
  league: 'Constellation',
  currency: 'Shards',
  gate: 'Field Vow',
} as const;

/** Stat ids stay STR/INT/…; this is what people see. */
export const STAT_LABELS: Record<Stat, string> = {
  STR: 'Body',
  INT: 'Mind',
  FOCUS: 'Focus',
  VIT: 'Vitality',
  DISCIPLINE: 'Discipline',
  CHA: 'Presence',
};

export const BANNED_WORDS = ['player', 'hunter', 'awaken', 'dungeon', 'shadow', 'arise'] as const;

const BANNED_PATTERN = new RegExp(`\\b(${BANNED_WORDS.join('|')})`, 'i');

/** True if the text uses vocabulary from the old brand (any case, word start: "Awakening", "Players"…). */
export function containsBannedWord(text: string): boolean {
  return BANNED_PATTERN.test(text);
}
