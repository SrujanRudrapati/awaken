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
  // reps (Home Base pad / phone / Watch)
  'pushup',
  'squat',
  'jumpingjack',
  'situp',
  'punch',
  // Home Base timers
  'jail',
  'meditate',
  'lightsout',
  // Apple Health (Shortcut sync)
  'run',
  'steps',
  'workout',
  'sleep',
  // AI-verified
  'photo',
  'gate',
  'quiz',
]);
export type QuestType = z.infer<typeof QuestTypeSchema>;

export const DifficultySchema = z.enum(['easy', 'normal', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** daily = midnight drop · emergency = timed surprise · penalty = harder retry after a failure. */
export const QuestKindSchema = z.enum(['daily', 'manual', 'emergency', 'penalty']);
export type QuestKind = z.infer<typeof QuestKindSchema>;

export const QuestStatusSchema = z.enum(['active', 'done', 'failed']);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

const Id = z.string().min(1);
const AnalogSchema = z.number().min(0).max(1023);

// ── Sensor sources → laptop ─────────────────────────────────────────────────

/** Where a reading came from: Home Base (Arduino over serial), iPhone `/hunter`, or Apple Watch. */
export const SourceSchema = z.enum(['homebase', 'phone', 'watch']);
export type Source = z.infer<typeof SourceSchema>;

/**
 * One sample from any source. Every sensor field is optional — the Home Base sends
 * pad/jail/btn/light/snd(/accel), the phone and Watch send only accel.
 * Not strict: extra fields are stripped, not rejected. `source` defaults to 'homebase'
 * so raw firmware JSON is accepted as-is.
 */
export const ReadingSchema = z.object({
  t: z.number().min(0), // ms since boot / page load
  source: SourceSchema.default('homebase'),
  pad: BitSchema.optional(), // push-up pad switch (D3)
  ax: z.number().optional(), // g
  ay: z.number().optional(),
  az: z.number().optional(),
  jail: BitSchema.optional(), // IR: phone present in the jail (D6)
  btn: BitSchema.optional(), // button (D2)
  light: AnalogSchema.optional(), // A1
  snd: AnalogSchema.optional(), // A0
});
export type Reading = z.infer<typeof ReadingSchema>;

// ── Laptop → Home Base (one command per line) ───────────────────────────────

export const BuzzSchema = z.enum(['alarm', 'chime', 'tick']);
export type Buzz = z.infer<typeof BuzzSchema>;

/** Grove 4-digit display shows exactly 4 characters. */
const SEG_PATTERN = /^SEG:[^\n\r]{4}$/;

const SegCommandSchema = z
  .templateLiteral(['SEG:', z.string()])
  .refine((cmd) => SEG_PATTERN.test(cmd), { message: 'SEG needs exactly 4 chars' });

export const DeviceCommandSchema = z.union([
  SegCommandSchema,
  z.literal('LOCK'),
  z.literal('UNLOCK'),
  z.templateLiteral(['BUZZ:', BuzzSchema]),
]);
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

// ── Game state ──────────────────────────────────────────────────────────────

export const QuestSchema = z.object({
  id: Id,
  playerId: Id,
  stat: StatSchema,
  title: z.string().min(1),
  type: QuestTypeSchema,
  target: z.number().positive(), // reps, seconds, km, steps, minutes, hours, photos…
  progress: z.number().min(0),
  xp: z.number().int().min(0),
  status: QuestStatusSchema,
  deadline: z.iso.datetime({ offset: true }),
  difficulty: DifficultySchema.optional(),
  kind: QuestKindSchema.optional(),
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
