/** Next.js server start hook: background listeners that must run even when no one is watching the stream. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startChronicle } = await import('./engine/agents/chronicle');
  startChronicle();
}
