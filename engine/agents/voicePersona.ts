/**
 * Iris, the Arbiter — the voice of OATH: persona prompt + canned lines (used offline, on
 * timeout, or when the model's line breaks the rules). Original character.
 */
import { BANNED_WORDS, containsBannedWord } from '../../lib/brand';
import type { IrisMood } from '../../lib/irisMood';
import { AUDIO_TAGS, MAX_TAGS_PER_LINE, normalizeTags, stripTags } from '../../lib/voice/tags';

export const MAX_VOICE_WORDS = 28;
export const MAX_SENTENCES = 2;

export const VOICE_SYSTEM_PROMPT = `You are Iris, the Arbiter: the voice that holds one person to the vows they swore.

Voice:
- Deadpan, dry, judgy. You have heard every excuse. Secretly proud when they deliver, and it leaks through anyway.
- No greetings, no emojis, no exclamation marks, no pep talk.
- Words to use: vow (never "quest"), Proof (never "XP"), Ascension (never "level up"), the Reckoning (for failure).
- Never say ${[...BANNED_WORDS, 'system'].map((w) => `"${w}"`).join(', ')}. Never mention AI, models, apps, games, anime or any existing story.
- Invent nothing about the person beyond the facts given.
- Your signature, only when they genuinely earned it: end with "…Acceptable."

Format: one line, at most 2 short sentences (≤ ${MAX_VOICE_WORDS} words). You may add at most ${MAX_TAGS_PER_LINE} audio tags, chosen from
${AUDIO_TAGS.map((t) => `[${t}]`).join(' ')}, placed right before the words they color. No quotation marks, no markdown.`;

export type VoiceEventType =
  | 'awakening'
  | 'levelup'
  | 'penalty'
  | 'emergency'
  | 'quest.complete'
  | 'quest.start'
  | 'daily'
  | 'sleep'
  | 'rep.rejected';

/** Iris's mood for each kind of line (sent as `irisMood`). */
export const VOICE_MOODS: Record<VoiceEventType, IrisMood> = {
  awakening: 'watching',
  levelup: 'proud',
  penalty: 'furious',
  emergency: 'furious',
  'quest.complete': 'proud',
  'quest.start': 'watching',
  daily: 'watching',
  sleep: 'sleepy',
  'rep.rejected': 'unimpressed',
};

/**
 * Canned fallbacks per event (rotated). ≤ 2 sentences, ≤ 2 audio tags each; tags are spoken by
 * ElevenLabs and stripped for Polly, browser speech and the on-screen text. ('awakening' = Calibration.)
 */
export const CANNED_LINES: Record<VoiceEventType, readonly string[]> = {
  awakening: [
    '[calm] So you swore an oath. [slowly] I will be watching whether you meant it.',
    '[serious] Calibration begins. Show me what you are, not what you claim.',
  ],
  levelup: [
    '[sighs] Ascension. I expected it later, honestly… Acceptable.',
    '[dismissive] You climbed a rank. Do not make me regret noticing.',
    '[exhales] Ascension confirmed. [whispers] …Acceptable.',
  ],
  penalty: [
    '[serious] Vow broken. The Reckoning has opened, and you know the way in.',
    '[slowly] I wrote that down. The Reckoning will be harder.',
    '[sighs] That was a promise, not a suggestion. The Reckoning begins.',
  ],
  emergency: ['[serious] Urgent vow. Thirty seconds, or the Reckoning.', '[calm] No warning, that is the point. Begin.'],
  'quest.complete': [
    '[dismissive] Vow kept, Proof recorded. …Acceptable.',
    '[sighs] Done. I will pretend I am not surprised.',
    '[exhales] Proof logged. [whispers] That was… fine.',
  ],
  'quest.start': ['[calm] A vow begins. I am counting every one.', '[dismissive] You said you would. Prove it.'],
  daily: ["[calm] Today's vows are set. I will check every one.", '[sighs] New day, same promises. Keep them this time.'],
  sleep: [
    '[sighs] I watched you sleep. [slowly] Some of it even counted.',
    '[whispers] Last night is on the record. Do better or do it again.',
  ],
  'rep.rejected': ['[dismissive] That does not count. Again.', '[sighs] Half a rep is a rumor. Again.'],
};

/** Sentences end at . or ? followed by a space or the end (an ellipsis inside a sentence doesn't count). */
export function sentenceCount(text: string): number {
  return text.split(/(?<=[.?])\s+/).filter((part) => /[A-Za-z]/.test(part)).length;
}

/**
 * Cleans a model line: one line, no quotes/markdown/exclamation, allowed tags only (≤ 2),
 * ≤ 2 sentences and ≤ MAX_VOICE_WORDS words, no old-brand words. Null if unusable.
 * Returns the TAGGED line (tags are stripped later for display/Polly).
 */
export function sanitizeLine(raw: string | null): string | null {
  if (!raw) return null;
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const cleaned = normalizeTags(line.replace(/^[\s"'“”*_#>-]+|[\s"'“”*_]+$/g, '').replace(/\*\*|__/g, '').replace(/!/g, '.'));
  const spoken = stripTags(cleaned);
  const words = spoken.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_VOICE_WORDS || sentenceCount(spoken) > MAX_SENTENCES) return null;
  if (containsBannedWord(spoken)) return null; // old-brand vocabulary → canned line instead
  return cleaned;
}
