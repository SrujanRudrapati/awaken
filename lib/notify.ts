/**
 * Phone + Apple Watch notifications via ntfy (POST https://ntfy.sh/<NTFY_TOPIC>).
 * The ntfy iOS app subscribes to the topic and mirrors alerts to the Watch.
 * Fire-and-forget: never throws, no-op without NTFY_TOPIC, 3 s timeout.
 */
const NTFY_BASE_URL = 'https://ntfy.sh';
export const NOTIFY_TIMEOUT_MS = 3_000;

/** ntfy priorities: urgent breaks through Focus on iOS (use for emergency/penalty only). */
export type NotifyPriority = 'low' | 'default' | 'high' | 'urgent';

export interface Notification {
  title: string;
  message: string;
  priority?: NotifyPriority;
  /** ntfy tags (emoji shortcodes like 'warning' render as icons). */
  tags?: readonly string[];
}

/** HTTP headers must be Latin-1; strip anything else from header values. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '').trim();
}

let warnedFailure = false;

/** Resolves true if ntfy accepted it. Never rejects. */
export async function push(notification: Notification): Promise<boolean> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return false;
  const headers: Record<string, string> = {
    Title: headerSafe(notification.title),
    Priority: notification.priority ?? 'default',
  };
  if (notification.tags?.length) headers.Tags = headerSafe(notification.tags.join(','));
  try {
    const res = await fetch(`${process.env.NTFY_URL || NTFY_BASE_URL}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: notification.message,
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
    warnedFailure = false;
    return true;
  } catch (error) {
    if (!warnedFailure) console.error('[notify] push failed:', error instanceof Error ? error.message : error);
    warnedFailure = true;
    return false;
  }
}

/** Fire-and-forget wrapper for game code. */
export function notify(notification: Notification): void {
  void push(notification);
}
