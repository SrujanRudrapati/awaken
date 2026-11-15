'use client';
/**
 * Subscribes to GET /api/stream (SSE) and hands validated events to `onEvent`. EventSource reconnects itself.
 * If no SSE message arrives for 5 s (a tunnel may buffer SSE), it polls GET /api/events?since=<id> every 1 s;
 * event ids de-duplicate the two paths, so each event is handed on once.
 */
import { useEffect, useRef, useState } from 'react';
import { StreamEventSchema, type StreamEvent } from '../../lib/schemas';
import { POLL_INTERVAL_MS, applyPoll, shouldPoll, type PollBody } from './eventPolling';

export function useSystemStream(onEvent: (event: StreamEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let lastId: number | null = null;
    let lastSseAt = Date.now();
    let polling = false;
    const deliver = (event: StreamEvent): void => {
      if (event.type !== 'reading') handler.current(event);
    };

    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message: MessageEvent<string>) => {
      lastSseAt = Date.now();
      const id = Number(message.lastEventId);
      if (Number.isInteger(id) && id > 0) {
        if (lastId !== null && id <= lastId) return; // the poller already delivered it
        lastId = id;
      }
      try {
        const parsed = StreamEventSchema.safeParse(JSON.parse(message.data));
        if (parsed.success) deliver(parsed.data);
      } catch {
        // malformed frame: ignore
      }
    };

    const poll = async (): Promise<void> => {
      if (polling || !shouldPoll(lastSseAt, Date.now())) return;
      polling = true;
      try {
        const res = await fetch(`/api/events?since=${lastId ?? 0}`, { cache: 'no-store' });
        const body = (await res.json()) as { success: boolean; data: PollBody | null };
        if (body.success && body.data) {
          const next = applyPoll(lastId, body.data);
          lastId = next.lastId;
          next.deliver.forEach(deliver);
          setConnected(true);
        }
      } catch {
        setConnected(false); // offline: try again next tick
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      source.close();
    };
  }, []);

  return connected;
}
