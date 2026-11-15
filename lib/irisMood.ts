/**
 * Iris's mood, attached to every SSE event (`irisMood`) so the UI can set her face/colour.
 * Voice events carry the mood of the moment they announce; everything else is derived here.
 */
import { z } from 'zod';
import type { StreamEvent } from './schemas';

export const IrisMoodSchema = z.enum(['watching', 'unimpressed', 'proud', 'furious', 'sleepy']);
export type IrisMood = z.infer<typeof IrisMoodSchema>;

export function moodFor(event: StreamEvent): IrisMood {
  switch (event.type) {
    case 'levelup':
    case 'quest.complete':
      return 'proud';
    case 'penalty':
      return 'furious';
    case 'rep.rejected':
      return 'unimpressed';
    case 'voice':
      return event.irisMood ?? 'watching';
    default:
      return 'watching';
  }
}

/** The event as sent over SSE: always with `irisMood`. */
export function withMood(event: StreamEvent): StreamEvent & { irisMood: IrisMood } {
  return { ...event, irisMood: moodFor(event) };
}
