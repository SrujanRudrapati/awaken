/**
 * Iris's audio tags (ElevenLabs v3 inline delivery cues). Lines keep them for ElevenLabs;
 * Polly, the browser and on-screen text get them stripped.
 */
export const AUDIO_TAGS = ['calm', 'slowly', 'whispers', 'sighs', 'serious', 'dismissive', 'exhales'] as const;
export type AudioTag = (typeof AUDIO_TAGS)[number];
export const MAX_TAGS_PER_LINE = 2;

const TAG_PATTERN = /\[([a-z ]+)\]/gi;

/** Removes every [tag] and tidies the spacing — for Polly, browser speech and display. */
export function stripTags(text: string): string {
  return text.replace(TAG_PATTERN, ' ').replace(/\s+/g, ' ').replace(/\s+([.,?])/g, '$1').trim();
}

/** Keeps only allowed tags, at most MAX_TAGS_PER_LINE (the first ones); unknown tags are removed. */
export function normalizeTags(text: string): string {
  let kept = 0;
  const cleaned = text.replace(TAG_PATTERN, (match, name: string) => {
    const tag = name.trim().toLowerCase();
    if (!(AUDIO_TAGS as readonly string[]).includes(tag) || kept >= MAX_TAGS_PER_LINE) return ' ';
    kept += 1;
    return `[${tag}]`;
  });
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function tagsIn(text: string): string[] {
  return [...text.matchAll(TAG_PATTERN)].map((m) => m[1].toLowerCase());
}
