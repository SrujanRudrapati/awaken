'use client';
/**
 * Subscribes to GET /api/stream (SSE). The browser's EventSource retries on its own
 * while the connection is merely interrupted; if it gives up (CLOSED), we reopen
 * with capped exponential backoff.
 */
import { useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '../schemas';
import { parseStreamMessage } from './state';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

const STREAM_URL = '/api/stream';
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

export function useStream(onEvent: (event: StreamEvent) => void): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = MIN_BACKOFF_MS;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      es = new EventSource(STREAM_URL);
      es.onopen = () => {
        backoff = MIN_BACKOFF_MS;
        setStatus('live');
      };
      es.onmessage = (msg: MessageEvent<string>) => {
        const event = parseStreamMessage(msg.data);
        if (event) handler.current(event);
      };
      es.onerror = () => {
        setStatus('reconnecting');
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          timer = setTimeout(open, backoff);
          backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
        }
      };
    };

    open();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);

  return status;
}
