'use client';
/** Subscribes to GET /api/stream (SSE) and hands validated events to `onEvent`. EventSource reconnects itself. */
import { useEffect, useRef, useState } from 'react';
import { StreamEventSchema, type StreamEvent } from '../../lib/schemas';

export function useSystemStream(onEvent: (event: StreamEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        const parsed = StreamEventSchema.safeParse(JSON.parse(message.data));
        if (parsed.success && parsed.data.type !== 'reading') handler.current(parsed.data);
      } catch {
        // malformed frame: ignore
      }
    };
    return () => source.close();
  }, []);

  return connected;
}
