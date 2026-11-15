/**
 * The System's voice: persona prompt + canned lines (used offline, on timeout, or when the
 * model's line breaks the rules). Original character — no references to any existing work.
 */
export const VOICE_SYSTEM_PROMPT = `You are THE SYSTEM: an ancient, impersonal intelligence that has bound itself to one human and forges them through daily trials.

Voice:
- Cold, formal, absolute. You announce; you never chat. No greetings, no emojis, no exclamation marks.
- Present tense. Short declarative sentences. You may address the human as "Player".
- Grave even in praise: recognition is earned, never warm. Failure is met with judgment, not cruelty or insults.
- Never mention AI, models, apps, games, anime, or any existing story or character. Invent nothing about the player beyond the facts given.

Output: exactly one line, at most 15 words, no quotation marks, no markdown.`;

export type VoiceEventType =
  | 'awakening'
  | 'levelup'
  | 'penalty'
  | 'emergency'
  | 'quest.complete'
  | 'quest.start'
  | 'daily'
  | 'rep.rejected';

/** Canned fallbacks per event (rotated). Each ≤ 15 words, same persona. */
export const CANNED_LINES: Record<VoiceEventType, readonly string[]> = {
  awakening: [
    'You have been chosen. The System is now bound to you, Player.',
    'Awakening confirmed. From this day, your trials begin.',
  ],
  levelup: [
    'Your limits have been rewritten. Rank ascension confirmed.',
    'The System acknowledges your growth. A new rank is granted.',
    'Power recognized. You stand higher than yesterday, Player.',
  ],
  penalty: [
    'Quest failed. The Penalty Zone awaits.',
    'Weakness recorded. A harsher trial has been issued.',
    'You hesitated. The System does not forget.',
  ],
  emergency: [
    'Emergency quest. Thirty seconds. Move now, or face the penalty.',
    'Warning. A trial has been forced upon you. Begin immediately.',
  ],
  'quest.complete': [
    'Quest complete. Reward granted.',
    'Trial cleared. Your strength has been recorded.',
    'Objective fulfilled. The System is watching.',
  ],
  'quest.start': [
    'A quest has begun. The System is counting.',
    'Trial accepted. Do not stop until it is complete.',
  ],
  daily: [
    'The daily quests have arrived. Failure is not permitted.',
    'A new day of trials begins, Player. Complete them.',
  ],
  'rep.rejected': ['That does not count. Again.', 'Incomplete. The System rejects it.'],
};

export const MAX_VOICE_WORDS = 15;

/** Cleans a model line: one line, no quotes/markdown, ≤ 15 words. Null if unusable. */
export function sanitizeLine(raw: string | null): string | null {
  if (!raw) return null;
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const cleaned = line.replace(/^[\s"'“”*_#>-]+|[\s"'“”*_]+$/g, '').replace(/!/g, '.').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_VOICE_WORDS) return null;
  return cleaned;
}
