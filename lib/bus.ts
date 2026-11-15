/**
 * In-process event bus: engine/API routes publish, the SSE route subscribes.
 * Stored on globalThis so Next.js hot reload doesn't orphan existing subscribers.
 */
import { EventEmitter } from 'node:events';
import { StreamEventSchema, type StreamEvent } from './schemas';

const CHANNEL = 'event';

type Listener = (event: StreamEvent) => void;

const globalForBus = globalThis as typeof globalThis & { __awakenBus?: EventEmitter };

function getEmitter(): EventEmitter {
  if (!globalForBus.__awakenBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // one listener per open SSE tab; no artificial cap
    globalForBus.__awakenBus = emitter;
  }
  return globalForBus.__awakenBus;
}

/** Validates against StreamEventSchema (throws on a bad payload) and fans out to subscribers. */
export function publish(event: StreamEvent): void {
  const parsed = StreamEventSchema.parse(event);
  getEmitter().emit(CHANNEL, parsed);
}

/** Returns an unsubscribe function. A throwing listener is logged and never blocks others. */
export function subscribe(fn: Listener): () => void {
  const safe: Listener = (event) => {
    try {
      fn(event);
    } catch (error) {
      console.error('[bus] subscriber threw on', event.type, error);
    }
  };
  const emitter = getEmitter();
  emitter.on(CHANNEL, safe);
  return () => {
    emitter.off(CHANNEL, safe);
  };
}
