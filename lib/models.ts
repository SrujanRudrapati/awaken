/**
 * Every runtime model id in one place. NEVER a Fable model at runtime (CLAUDE.md rule) —
 * assertNotFable() guards the env-overridable ids too.
 */
export const HAIKU = 'claude-haiku-5-5'; // voice lines, quiz
export const OPUS = 'claude-opus-5-5'; // boss / weekly report

const DEFAULT_GEMINI = 'gemini-2.5-flash';

export function isFable(id: string): boolean {
  return /fable/i.test(id);
}

export function assertNotFable(id: string): string {
  if (isFable(id)) throw new Error(`Fable models are not allowed at runtime (got ${id})`);
  return id;
}

/** Gemini text model (quest designer). */
export function geminiModel(): string {
  return assertNotFable(process.env.GEMINI_MODEL || DEFAULT_GEMINI);
}

/** Gemini vision model (photo proof). */
export function geminiVisionModel(): string {
  return assertNotFable(process.env.GEMINI_VISION_MODEL || geminiModel());
}

export const CLAUDE_MODELS = [HAIKU, OPUS].map(assertNotFable);
