/** Words the band shows (pure, unit-tested). */
import { STAT_LABELS } from '../../lib/brand';
import type { Quest } from '../../lib/schemas';
import type { PhoneQuestType } from '../hunter/api';
import type { MotionStatus } from '../hunter/useMotionSender';

export const VOW_CARDS: readonly { type: PhoneQuestType; name: string; unit: string; stat: string; glyph: string }[] = [
  { type: 'squat', name: 'Squats', unit: 'squats', stat: STAT_LABELS.STR, glyph: '◇' },
  { type: 'pushup', name: 'Push-ups', unit: 'push-ups', stat: STAT_LABELS.STR, glyph: '▽' },
  { type: 'jumpingjack', name: 'Jumping jacks', unit: 'jumping jacks', stat: STAT_LABELS.VIT, glyph: '✦' },
  { type: 'situp', name: 'Sit-ups', unit: 'sit-ups', stat: STAT_LABELS.VIT, glyph: '◐' },
];

export const SENSOR_STATUS: Record<MotionStatus, string> = {
  idle: 'Sensor idle',
  requesting: 'Asking for motion access…',
  streaming: 'Sensor linked',
  denied: 'Motion access denied — Settings › Safari › Motion & Orientation',
  unsupported: 'No motion sensor on this device',
  offline: 'Signal lost — retrying',
};

export function vowKicker(quest: Pick<Quest, 'kind' | 'stat'>): string {
  const stat = STAT_LABELS[quest.stat];
  switch (quest.kind) {
    case 'emergency':
      return `Urgent vow · ${stat}`;
    case 'penalty':
      return `Reckoning vow · ${stat}`;
    case 'calibration':
      return `Calibration · ${stat}`;
    case 'daily':
      return `Today's vow · ${stat}`;
    default:
      return `Vow · ${stat}`;
  }
}

export function vowUnit(type: Quest['type']): string {
  return VOW_CARDS.find((c) => c.type === type)?.unit ?? 'reps';
}

/** "07" — the counter never shows fewer than two digits. */
export function padCount(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Seconds left as "0:27"; "0:00" once past. */
export function clockLeft(deadlineIso: string, nowMs: number): string {
  const left = Math.max(0, Math.ceil((Date.parse(deadlineIso) - nowMs) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
