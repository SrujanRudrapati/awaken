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

/** Rank letters, E (start) → A (top). There is no S rank. */
export const RankSchema = z.enum(['E', 'D', 'C', 'B', 'A']);
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

/** cancelled = switched away from (no penalty); failed = missed (Penalty Zone). */
export const QuestStatusSchema = z.enum(['active', 'done', 'failed', 'cancelled']);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

const Id = z.string().min(1);
const AnalogSchema = z.number().min(0).max(1023);

// ── Sensor sources → laptop ─────────────────────────────────────────────────

/** Where a reading came from: Home Base (Arduino over serial), iPhone `/hunter`, or Apple Watch. */
export const SourceSchema = z.enum(['homebase', 'phone', 'watch']);
export type Source = z.infer<typeof SourceSchema>;

/** Firmware reports absent hardware as `null`; treat it exactly like a missing field. */
function dropNulls(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
}

/**
 * One sample from any source. Every sensor field is optional — the Home Base sends
 * pad/btn/light/snd/accel (+ jail when the IR sensor is fitted), the phone and Watch send
 * only accel. `null` (absent hardware) is the same as missing. Not strict: extra fields
 * (e.g. `servo`) are stripped, not rejected. `source` defaults to 'homebase' so raw
 * firmware JSON is accepted as-is.
 */
export const ReadingSchema = z.preprocess(
  dropNulls,
  z.object({
    t: z.number().min(0), // ms since boot / page load
    source: SourceSchema.default('homebase'),
    pad: BitSchema.optional(), // push-up pad / micro switch (D6)
    ax: z.number().optional(), // g (MMA7660FC on I2C 0x4C, or phone/Watch)
    ay: z.number().optional(),
    az: z.number().optional(),
    jail: BitSchema.optional(), // optional IR reflective (D7): phone present in the jail
    btn: BitSchema.optional(), // button (D2)
    light: AnalogSchema.optional(), // A0
    snd: AnalogSchema.optional(), // A1, loudest sample in the 100 ms window
  }),
);
export type Reading = z.infer<typeof ReadingSchema>;

// ── Laptop → Home Base (one command per line) ───────────────────────────────

export const BuzzSchema = z.enum(['alarm', 'chime', 'tick']);
export type Buzz = z.infer<typeof BuzzSchema>;

/** The 4-char alphanumeric display (HT16K33, I2C 0x71) shows exactly 4 characters. */
const SEG_PATTERN = /^SEG:[^\n\r]{4}$/;

const SegCommandSchema = z
  .templateLiteral(['SEG:', z.string()])
  .refine((cmd) => SEG_PATTERN.test(cmd), { message: 'SEG needs exactly 4 chars' });

export const DeviceCommandSchema = z.union([
  SegCommandSchema,
  z.literal('LOCK'),
  z.literal('UNLOCK'),
  z.templateLiteral(['BUZZ:', BuzzSchema]),
  // Optional hardware on/off (servo D5, IR D7); the bridge sends these from env on connect.
  z.enum(['CFG:IR:0', 'CFG:IR:1', 'CFG:SERVO:0', 'CFG:SERVO:1']),
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

// ── Apple Health sync (iPhone Shortcut → POST /api/health) ──────────────────

/** Shortcuts may send numbers as text — coerce, then bound to sane human values. */
const healthNumber = (max: number) => z.coerce.number().finite().min(0).max(max).optional();

export const HealthSyncSchema = z.object({
  /** Optional: falls back to HEALTH_PLAYER_ID (the Shortcut belongs to one phone). */
  playerId: Id.max(64).optional(),
  /** The day the totals are for, as the Shortcut formats it (informational). */
  date: z.string().max(40).optional(),
  steps: healthNumber(200_000),
  distanceKm: healthNumber(300),
  activeKcal: healthNumber(20_000),
  workoutMinutes: healthNumber(24 * 60),
  sleepHours: healthNumber(24),
  avgHeartRate: z.coerce.number().finite().min(20).max(250).optional(),
});
export type HealthSync = z.infer<typeof HealthSyncSchema>;

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
    /** ElevenLabs/Polly MP3 (`/api/voice/<hash>.mp3`); absent → the browser speaks `text` itself. */
    audioUrl: z.string().startsWith('/api/voice/').optional(),
    /** Iris's mood for this line (see lib/irisMood.ts; every SSE event carries one). */
    irisMood: z.enum(['watching', 'unimpressed', 'proud', 'furious', 'sleepy']).optional(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StreamEventType = StreamEvent['type'];
