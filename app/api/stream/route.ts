/**
 * GET /api/stream — Server-Sent Events. Each bus event is written as
 * `id: <n>\ndata: <StreamEvent JSON + irisMood>\n\n`; a 2 KB first comment flushes buffering proxies and a
 * comment heartbeat every 10 s keeps them from idling out. Fallback for buffered networks: GET /api/events.
 *
 * Note: next.config has `cacheComponents: true`, which forbids `export const runtime`
 * and replaces `dynamic = 'force-dynamic'` — `await connection()` keeps this at request time.
 */
import { connection } from 'next/server';
import { startVoice } from '../../../engine/agents/voice';
import { subscribe } from '../../../lib/bus';
import { withMood } from '../../../lib/irisMood';

export const HEARTBEAT_MS = 10_000;
/** Some proxies hold the first few KB of a response; a 2 KB comment pushes the stream through at once. */
const FLUSH_PADDING = `: ${' '.repeat(2048)}\n\n`;

export async function GET(request: Request): Promise<Response> {
  await connection();
  startVoice(); // Iris speaks while someone is watching

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(); // controller already closed (client gone)
        }
      };

      // `id:` lets EventSource resume (Last-Event-ID) and matches GET /api/events?since=<id>.
      const unsubscribe = subscribe((event, id) => write(`id: ${id}\ndata: ${JSON.stringify(withMood(event))}\n\n`));
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener('abort', cleanup);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener('abort', cleanup);
      write(FLUSH_PADDING);
      write(': connected\n\n');
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
