/**
 * In-process event bus: engine/API routes publish, the SSE route subscribes.
 * Every event gets an increasing id; the newest non-`reading` events are kept so a client that
 * can't hold an SSE connection (e.g. through a buffering tunnel) can poll GET /api/events?since=<id>.
 * Stored on globalThis so Next.js hot reload doesn't orphan existing subscribers.
 */
import { EventEmitter } from 'node:events';
import { StreamEventSchema, type StreamEvent } from './schemas';

const CHANNEL = 'event';
/** How many events the polling fallback can replay (raw readings are never kept). */
export const EVENT_LOG_SIZE = 500;

type Listener = (event: StreamEvent, id: number) => void;

export interface LoggedEvent {
  id: number;
  event: StreamEvent;
}

interface BusState {
  emitter: EventEmitter;
  seq: number;
  log: LoggedEvent[];
}

const globalForBus = globalThis as typeof globalThis & { __awakenBus?: BusState | EventEmitter };

function getBus(): BusState {
  const current = globalForBus.__awakenBus;
  if (current && !(current instanceof EventEmitter)) return current;
  // First call, or a hot reload over the older bare-emitter bus: adopt it so its subscribers keep working.
  const emitter = current ?? new EventEmitter();
  emitter.setMaxListeners(0); // one listener per open SSE tab; no artificial cap
  const bus: BusState = { emitter, seq: 0, log: [] };
  globalForBus.__awakenBus = bus;
  return bus;
}

/** Validates against StreamEventSchema (throws on a bad payload), numbers it, keeps it, and fans out. */
export function publish(event: StreamEvent): void {
  const parsed = StreamEventSchema.parse(event);
  const bus = getBus();
  bus.seq += 1;
  const id = bus.seq;
  if (parsed.type !== 'reading') {
    bus.log = [...bus.log, { id, event: parsed }].slice(-EVENT_LOG_SIZE);
  }
  bus.emitter.emit(CHANNEL, parsed, id);
}

/** Returns an unsubscribe function. A throwing listener is logged and never blocks others. */
export function subscribe(fn: Listener): () => void {
  const safe: Listener = (event, id) => {
    try {
      fn(event, id);
    } catch (error) {
      console.error('[bus] subscriber threw on', event.type, error);
    }
  };
  const { emitter } = getBus();
  emitter.on(CHANNEL, safe);
  return () => {
    emitter.off(CHANNEL, safe);
  };
}

/**
 * Kept events with id > `since`, oldest first, and the newest id issued.
 * A `since` ahead of the server (it restarted and ids began again) replays everything kept.
 */
export function eventsSince(since: number): { events: LoggedEvent[]; lastId: number } {
  const { log, seq } = getBus();
  const from = since > seq ? 0 : since;
  return { events: log.filter((e) => e.id > from), lastId: seq };
}

/** Test hook: forget the log and restart ids (subscribers are kept). */
export function resetBus(): void {
  const bus = getBus();
  bus.seq = 0;
  bus.log = [];
}
