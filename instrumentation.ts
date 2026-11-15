/** Next.js server start hook: background listeners that must run even when no one is watching the stream. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startChronicle } = await import('./engine/agents/chronicle');
  startChronicle();
  const { warmUp } = await import('./lib/db');
  warmUp().catch((error: unknown) => console.error('[db] warm-up failed:', error instanceof Error ? error.message : error));
}
