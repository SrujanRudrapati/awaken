/**
 * GET /api/stream — Server-Sent Events. Each bus event is written as
 * `data: <StreamEvent JSON + irisMood>\n\n`; a comment heartbeat keeps proxies from idling out.
 *
 * Note: next.config has `cacheComponents: true`, which forbids `export const runtime`
 * and replaces `dynamic = 'force-dynamic'` — `await connection()` keeps this at request time.
 */
import { connection } from 'next/server';
import { startVoice } from '../../../engine/agents/voice';
import { subscribe } from '../../../lib/bus';
import { withMood } from '../../../lib/irisMood';

const HEARTBEAT_MS = 15_000;

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

      const unsubscribe = subscribe((event) => write(`data: ${JSON.stringify(withMood(event))}\n\n`));
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
