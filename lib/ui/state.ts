/**
 * UI state: a pure reducer that folds SSE `StreamEvent`s into what the screens draw.
 * The UI never decides whether a rep counted — it only displays what the engine published.
 */
import {
  StreamEventSchema,
  type Quest,
  type Rank,
  type Reading,
  type Stat,
  type StreamEvent,
} from '../schemas';
import { STATS } from './ranks';

export type Overlay =
  | { kind: 'complete'; seq: number; quest: Quest; xpGained: number }
  | { kind: 'levelup'; seq: number; fromRank: Rank; toRank: Rank; level: number }
  | { kind: 'penalty'; seq: number; reason: string };

export interface VoiceLine {
  seq: number;
  text: string;
  eventType: string;
}

export interface UiState {
  name: string | null;
  rank: Rank;
  level: number;
  xp: number;
  stats: Record<Stat, number>;
  penalty: boolean;
  quests: Record<string, Quest>;
  activeQuestId: string | null;
  reading: Reading | null;
  /** Last counted rep (seq changes on every rep so the UI can pulse). */
  lastRep: { seq: number; count: number } | null;
  /** Last rejected half-rep, for the "REP NOT COUNTED" flash. */
  rejected: { seq: number; reason: string } | null;
  voice: VoiceLine[];
  /** Queue: the first entry is on screen; dismiss pops it. */
  overlays: Overlay[];
  /** True once any synthetic demo event was injected — drives the DEMO badge. */
  demo: boolean;
  seq: number;
}

export type UiAction =
  | { type: 'event'; event: StreamEvent; demo?: boolean }
  | { type: 'dismissOverlay' }
  | { type: 'clearPenalty' }
  | { type: 'setName'; name: string | null };

const MAX_VOICE = 6;
const MAX_OVERLAYS = 5;

export function initialState(name: string | null = null): UiState {
  return {
    name,
    rank: 'E',
    level: 1,
    xp: 0,
    stats: Object.fromEntries(STATS.map((s) => [s, 0])) as Record<Stat, number>,
    penalty: false,
    quests: {},
    activeQuestId: null,
    reading: null,
    lastRep: null,
    rejected: null,
    voice: [],
    overlays: [],
    demo: false,
    seq: 0,
  };
}

/** Parses one SSE `data:` payload. Returns null (and logs) for anything off-contract. */
export function parseStreamMessage(data: string): StreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    console.warn('[stream] non-JSON message dropped', data);
    return null;
  }
  const parsed = StreamEventSchema.safeParse(json);
  if (!parsed.success) {
    console.warn('[stream] off-contract event dropped', parsed.error.issues);
    return null;
  }
  return parsed.data;
}

function pushOverlay(overlays: Overlay[], overlay: Overlay): Overlay[] {
  // Level-ups jump the queue: they are the moment the demo is built around.
  const next = overlay.kind === 'levelup' ? [overlay, ...overlays] : [...overlays, overlay];
  return next.slice(0, MAX_OVERLAYS);
}

function applyEvent(state: UiState, event: StreamEvent): UiState {
  const seq = state.seq + 1;
  const base = { ...state, seq };

  switch (event.type) {
    case 'reading':
      return { ...state, reading: event.reading }; // no seq bump: 10/s, nothing keys on it

    case 'rep':
      return { ...base, activeQuestId: event.questId, lastRep: { seq, count: event.count } };

    case 'rep.rejected':
      return { ...base, activeQuestId: event.questId, rejected: { seq, reason: event.reason } };

    case 'quest.update':
      return {
        ...base,
        quests: { ...state.quests, [event.quest.id]: event.quest },
        activeQuestId: event.quest.status === 'active' ? event.quest.id : state.activeQuestId,
      };

    case 'quest.complete': {
      const { quest, xpGained } = event;
      // TODO(backend): replace with GET /api/player once the quest engine (Phase 7) lands.
      const already = state.quests[quest.id]?.status === 'done';
      return {
        ...base,
        quests: { ...state.quests, [quest.id]: quest },
        activeQuestId: quest.id,
        xp: already ? state.xp : state.xp + xpGained,
        stats: already ? state.stats : { ...state.stats, [quest.stat]: state.stats[quest.stat] + 1 },
        overlays: already
          ? state.overlays
          : pushOverlay(state.overlays, { kind: 'complete', seq, quest, xpGained }),
      };
    }

    case 'levelup':
      return {
        ...base,
        rank: event.toRank,
        level: event.level,
        overlays: pushOverlay(state.overlays, {
          kind: 'levelup',
          seq,
          fromRank: event.fromRank,
          toRank: event.toRank,
          level: event.level,
        }),
      };

    case 'penalty':
      return {
        ...base,
        penalty: true,
        quests:
          event.questId && state.quests[event.questId]
            ? { ...state.quests, [event.questId]: { ...state.quests[event.questId], status: 'failed' } }
            : state.quests,
        overlays: pushOverlay(state.overlays, { kind: 'penalty', seq, reason: event.reason }),
      };

    case 'voice':
      return {
        ...base,
        voice: [...state.voice, { seq, text: event.text, eventType: event.eventType }].slice(-MAX_VOICE),
      };
  }
}

export function reduce(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'event': {
      const next = applyEvent(state, action.event);
      return action.demo && !next.demo ? { ...next, demo: true } : next;
    }
    case 'dismissOverlay':
      return state.overlays.length ? { ...state, overlays: state.overlays.slice(1) } : state;
    case 'clearPenalty':
      return { ...state, penalty: false };
    case 'setName':
      return { ...state, name: action.name };
  }
}

export function activeQuest(state: UiState): Quest | null {
  return state.activeQuestId ? (state.quests[state.activeQuestId] ?? null) : null;
}
