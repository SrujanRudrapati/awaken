/** Pure helpers over stream events (unit-tested). */
import type { StreamEvent } from '../../lib/schemas';

/** The person an event is about, if any (`reading` and broadcast voice lines have none). */
export function eventPersonId(event: StreamEvent): string | undefined {
  switch (event.type) {
    case 'reading':
      return undefined;
    case 'quest.update':
    case 'quest.complete':
      return event.quest.playerId;
    default:
      return event.playerId;
  }
}

/** True when the signed-in person should see this event (their own, or a broadcast). */
export function isForPerson(event: StreamEvent, personId: string | null): boolean {
  const owner = eventPersonId(event);
  return owner === undefined || owner === personId;
}

const DEPTH_REASON = /deep|depth|shallow|half/i;

/** What flashes under the counter when a rep is thrown out. */
export function rejectionLine(reason: string): string {
  if (DEPTH_REASON.test(reason)) return 'Not counted — go deeper';
  const clean = reason.trim().replace(/[.!]+$/, '');
  return clean ? `Not counted — ${clean.toLowerCase()}` : 'Not counted';
}
