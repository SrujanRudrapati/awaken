/**
 * Chronicle: turns game events into short facts in the player's Supermemory namespace —
 * every cleared or failed quest and every level-up — so the designer and voice can call
 * back to them ("You skipped squats twice this week."). Started once per server process
 * (instrumentation.ts); does nothing when Supermemory isn't configured.
 */
import { subscribe } from '../../lib/bus';
import { isMemoryConfigured, remember } from '../../lib/memory';
import type { Quest, StreamEvent } from '../../lib/schemas';

interface ChronicleState {
  recordedFailures: Set<string>;
  unsubscribe: () => void;
}
const globalForChronicle = globalThis as typeof globalThis & { __awakenChronicle?: ChronicleState };

function day(): string {
  return new Date().toISOString().slice(0, 10);
}

function questLabel(quest: Quest): string {
  return `"${quest.title}" (${quest.type}, ${quest.stat}${quest.kind && quest.kind !== 'manual' ? `, ${quest.kind}` : ''})`;
}

export interface MemoryEntry {
  playerId: string;
  content: string;
  kind: 'quest' | 'milestone';
  metadata: Record<string, string | number | boolean>;
}

/** Pure: the fact worth remembering for an event, or null. Failures are recorded once per quest. */
export function entryFor(event: StreamEvent, recordedFailures: Set<string>): MemoryEntry | null {
  switch (event.type) {
    case 'quest.complete': {
      const { quest } = event;
      return {
        playerId: quest.playerId,
        kind: 'quest',
        content: `${day()}: Player cleared quest ${questLabel(quest)} for ${event.xpGained} XP.`,
        metadata: { outcome: 'done', questType: quest.type, stat: quest.stat },
      };
    }
    case 'quest.update': {
      const { quest } = event;
      if (quest.status !== 'failed' || recordedFailures.has(quest.id)) return null;
      recordedFailures.add(quest.id);
      return {
        playerId: quest.playerId,
        kind: 'quest',
        content: `${day()}: Player FAILED quest ${questLabel(quest)} — reached ${Math.floor(quest.progress)} of ${quest.target}.`,
        metadata: { outcome: 'failed', questType: quest.type, stat: quest.stat },
      };
    }
    case 'levelup':
      return {
        playerId: event.playerId,
        kind: 'milestone',
        content: `${day()}: Player reached level ${event.level}${event.fromRank !== event.toRank ? ` and rank ${event.toRank} (from ${event.fromRank})` : ''}.`,
        metadata: { level: event.level, rank: event.toRank },
      };
    default:
      return null;
  }
}

/** Idempotent. Returns false (and does nothing) without SUPERMEMORY_API_KEY. */
export function startChronicle(): boolean {
  if (globalForChronicle.__awakenChronicle) return true;
  if (!isMemoryConfigured()) return false;
  const state: ChronicleState = { recordedFailures: new Set(), unsubscribe: () => {} };
  state.unsubscribe = subscribe((event) => {
    const entry = entryFor(event, state.recordedFailures);
    if (entry) void remember(entry.playerId, entry.content, { kind: entry.kind, metadata: entry.metadata });
  });
  globalForChronicle.__awakenChronicle = state;
  return true;
}

/** Test hook. */
export function stopChronicle(): void {
  globalForChronicle.__awakenChronicle?.unsubscribe();
  globalForChronicle.__awakenChronicle = undefined;
}
