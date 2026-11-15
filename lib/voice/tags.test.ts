import { describe, expect, it } from 'vitest';
import { normalizeTags, stripTags, tagsIn } from './tags';

describe('audio tags', () => {
  it('strips tags for Polly / browser / display, tidying spaces', () => {
    expect(stripTags('[sighs] Ascension. [whispers] …Acceptable.')).toBe('Ascension. …Acceptable.');
    expect(stripTags('No tags here.')).toBe('No tags here.');
  });

  it('keeps at most two allowed tags and drops unknown ones', () => {
    expect(normalizeTags('[laughs] [calm] One. [Serious] Two. [sighs] three.')).toBe('[calm] One. [serious] Two. three.');
    expect(tagsIn('[calm] a [slowly] b')).toEqual(['calm', 'slowly']);
  });
});
