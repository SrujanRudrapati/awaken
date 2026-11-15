/**
 * The System's voice. Listens to the bus, picks the most important moment in a short window
 * (a level-up beats the quest completion that caused it), asks Haiku for one ≤15-word line,
 * and publishes a `voice` event — falling back to a canned line if the model is slow or offline.
 *
 * Started once per process by startVoice() (the SSE route calls it). rep.rejected uses canned
 * lines only (it fires too often to spend a model call on).
 */
import { publish, subscribe } from '../../lib/bus';
import { claude } from '../../lib/llm';
import type { StreamEvent } from '../../lib/schemas';
import { CANNED_LINES, VOICE_SYSTEM_PROMPT, sanitizeLine, type VoiceEventType } from './voicePersona';

/** Collect events this long before speaking, so related events become one line. */
export const VOICE_WINDOW_MS = 300;
/** A voice line later than this is stale on stage. */
export const VOICE_TIMEOUT_MS = 3_000;
/** Minimum gap between canned rep.rejected lines. */
const REJECT_COOLDOWN_MS = 5_000;

const PRIORITY: Record<VoiceEventType, number> = {
  levelup: 5,
  penalty: 4,
  emergency: 3,
  'quest.complete': 2,
  daily: 1,
  'rep.rejected': 0,
};

interface Moment {
  type: VoiceEventType;
  playerId?: string;
  facts: string;
}

interface VoiceState {
  pending: Moment | null;
  timer: ReturnType<typeof setTimeout> | null;
  seenQuestIds: Set<string>;
  cannedIndex: number;
  lastRejectAt: number;
  unsubscribe: () => void;
}

const globalForVoice = globalThis as typeof globalThis & { __awakenVoice?: VoiceState };

/** Turns a bus event into a voice-worthy moment, or null. */
export function momentFor(event: StreamEvent, seenQuestIds: Set<string>): Moment | null {
  switch (event.type) {
    case 'levelup':
      return { type: 'levelup', playerId: event.playerId, facts: `Rank ${event.fromRank} → ${event.toRank}, level ${event.level}.` };
    case 'penalty':
      return { type: 'penalty', playerId: event.playerId, facts: `Failure: ${event.reason}` };
    case 'quest.complete':
      return { type: 'quest.complete', playerId: event.quest.playerId, facts: `Completed "${event.quest.title}" for ${event.xpGained} XP.` };
    case 'quest.update': {
      const { quest } = event;
      if (quest.status !== 'active' || seenQuestIds.has(quest.id)) return null;
      seenQuestIds.add(quest.id);
      if (quest.kind === 'emergency') return { type: 'emergency', playerId: quest.playerId, facts: `Emergency: "${quest.title}".` };
      if (quest.kind === 'daily') return { type: 'daily', playerId: quest.playerId, facts: 'New daily quests were issued.' };
      return null;
    }
    case 'rep.rejected':
      return { type: 'rep.rejected', playerId: event.playerId, facts: event.reason };
    default:
      return null;
  }
}

function canned(state: VoiceState, type: VoiceEventType): string {
  const lines = CANNED_LINES[type];
  state.cannedIndex += 1;
  return lines[state.cannedIndex % lines.length];
}

async function speak(state: VoiceState, moment: Moment): Promise<void> {
  const line =
    moment.type === 'rep.rejected'
      ? null
      : sanitizeLine(
          await claude({
            system: VOICE_SYSTEM_PROMPT,
            prompt: `Event: ${moment.type}. ${moment.facts}\nAnnounce it.`,
            maxTokens: 200,
            timeoutMs: VOICE_TIMEOUT_MS,
          }),
        );
  publish({ type: 'voice', text: line ?? canned(state, moment.type), eventType: moment.type, playerId: moment.playerId });
}

function onEvent(state: VoiceState, event: StreamEvent): void {
  const moment = momentFor(event, state.seenQuestIds);
  if (!moment) return;
  if (moment.type === 'rep.rejected') {
    const now = Date.now();
    if (now - state.lastRejectAt < REJECT_COOLDOWN_MS || state.pending) return;
    state.lastRejectAt = now;
  }
  if (!state.pending || PRIORITY[moment.type] > PRIORITY[state.pending.type]) state.pending = moment;
  state.timer ??= setTimeout(() => {
    const chosen = state.pending;
    state.pending = null;
    state.timer = null;
    if (chosen) void speak(state, chosen);
  }, VOICE_WINDOW_MS);
}

/** Starts the voice once per process (safe to call from every route). */
export function startVoice(): void {
  if (globalForVoice.__awakenVoice) return;
  const state: VoiceState = {
    pending: null,
    timer: null,
    seenQuestIds: new Set(),
    cannedIndex: -1,
    lastRejectAt: 0,
    unsubscribe: () => {},
  };
  state.unsubscribe = subscribe((event) => onEvent(state, event));
  globalForVoice.__awakenVoice = state;
}

/** Test hook. */
export function stopVoice(): void {
  const state = globalForVoice.__awakenVoice;
  if (!state) return;
  state.unsubscribe();
  if (state.timer) clearTimeout(state.timer);
  globalForVoice.__awakenVoice = undefined;
}
