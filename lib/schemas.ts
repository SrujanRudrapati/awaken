/**
 * Shared contracts for Awaken (SPEC §3). Lead-owned: bridge, engine, API routes
 * and UI all import from here. Change only with the team's agreement.
 */
import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────────

export const BitSchema = z.union([z.literal(0), z.literal(1)]);
export type Bit = z.infer<typeof BitSchema>;

export const StatSchema = z.enum(['STR', 'INT', 'FOCUS', 'VIT', 'DISCIPLINE', 'CHA']);
export type Stat = z.infer<typeof StatSchema>;

export const RankSchema = z.enum(['E', 'D', 'C', 'B', 'A', 'S']);
export type Rank = z.infer<typeof RankSchema>;

export const QuestTypeSchema = z.enum([
  'pushup',
  'squat',
  'jail',
  'meditate',
  'lightsout',
  'water',
  'photo',
  'gate',
  'quiz',
]);
export type QuestType = z.infer<typeof QuestTypeSchema>;

export const QuestStatusSchema = z.enum(['active', 'done', 'failed']);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

const Id = z.string().min(1);
const AnalogSchema = z.number().min(0).max(1023);

// ── Device → laptop (one JSON line every 100 ms) ────────────────────────────

/** Not strict: extra firmware fields are stripped, not rejected. */
export const ReadingSchema = z.object({
  t: z.number().min(0), // ms since boot
  dist: z.number().min(0), // cm
  ax: z.number(), // g
  ay: z.number(),
  az: z.number(),
  jail: BitSchema,
  touch: BitSchema,
  light: AnalogSchema,
  snd: AnalogSchema,
  bottle: BitSchema,
  btn: BitSchema,
});
export type Reading = z.infer<typeof ReadingSchema>;

// ── Laptop → device (one command per line) ──────────────────────────────────

export const ColorSchema = z.enum(['blue', 'red', 'gold', 'green']);
export type Color = z.infer<typeof ColorSchema>;

export const BuzzSchema = z.enum(['alarm', 'chime', 'tick']);
export type Buzz = z.infer<typeof BuzzSchema>;

/** Grove LCD RGB Backlight is 16×2. */
export const LCD_LINE_MAX = 16;
const LCD_PATTERN = new RegExp(`^LCD:[^|\\n\\r]{0,${LCD_LINE_MAX}}\\|[^|\\n\\r]{0,${LCD_LINE_MAX}}$`);
const SEG_PATTERN = /^SEG:[^\n\r]{4}$/;

const LcdCommandSchema = z
  .templateLiteral(['LCD:', z.string(), '|', z.string()])
  .refine((cmd) => LCD_PATTERN.test(cmd), {
    message: `LCD lines must be ≤${LCD_LINE_MAX} chars with no '|' or newline`,
  });

const SegCommandSchema = z
  .templateLiteral(['SEG:', z.string()])
  .refine((cmd) => SEG_PATTERN.test(cmd), { message: 'SEG needs exactly 4 chars' });

export const DeviceCommandSchema = z.union([
  LcdCommandSchema,
  z.templateLiteral(['COLOR:', ColorSchema]),
  z.literal('LOCK'),
  z.literal('UNLOCK'),
  z.templateLiteral(['BUZZ:', BuzzSchema]),
  SegCommandSchema,
]);
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

// ── Game state ──────────────────────────────────────────────────────────────

export const QuestSchema = z.object({
  id: Id,
  playerId: Id,
  stat: StatSchema,
  title: z.string().min(1),
  type: QuestTypeSchema,
  target: z.number().positive(), // reps, seconds, bottles, photos…
  progress: z.number().min(0),
  xp: z.number().int().min(0),
  status: QuestStatusSchema,
  deadline: z.iso.datetime({ offset: true }),
});
export type Quest = z.infer<typeof QuestSchema>;

export const PlayerSchema = z.object({
  id: Id,
  name: z.string().min(1),
  rank: RankSchema,
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  stats: z.record(StatSchema, z.number().int().min(0)), // every stat required
  penalty: z.boolean(),
});
export type Player = z.infer<typeof PlayerSchema>;

// ── SSE stream events (names fixed — see SPEC §3) ───────────────────────────

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reading'), reading: ReadingSchema }),
  z.object({
    type: z.literal('rep'),
    playerId: Id,
    questId: Id,
    count: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('rep.rejected'),
    playerId: Id,
    questId: Id,
    reason: z.string().min(1),
  }),
  z.object({ type: z.literal('quest.update'), quest: QuestSchema }),
  z.object({
    type: z.literal('quest.complete'),
    quest: QuestSchema,
    xpGained: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('levelup'),
    playerId: Id,
    fromRank: RankSchema,
    toRank: RankSchema,
    level: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('penalty'),
    playerId: Id,
    questId: Id.optional(),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal('voice'),
    text: z.string().min(1),
    eventType: z.string().min(1), // which event triggered the line
    playerId: Id.optional(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StreamEventType = StreamEvent['type'];
