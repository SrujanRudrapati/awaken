/** How vows are grouped, labelled and acted on from the Today screen (pure, unit-tested). */
import { STAT_LABELS } from '../../lib/brand';
import type { Quest, QuestType } from '../../lib/schemas';

export type VowGroupKey = 'urgent' | 'reckoning' | 'today' | 'sworn' | 'kept' | 'broken';

export interface VowGroup {
  key: VowGroupKey;
  label: string;
  vows: Quest[];
}

const GROUP_LABEL: Record<VowGroupKey, string> = {
  urgent: 'Urgent vow',
  reckoning: 'The Reckoning',
  today: "Today's vows",
  sworn: 'Sworn by you',
  kept: 'Kept',
  broken: 'Broken',
};
const GROUP_ORDER: readonly VowGroupKey[] = ['urgent', 'reckoning', 'today', 'sworn', 'kept', 'broken'];

function groupOf(vow: Quest): VowGroupKey | null {
  if (vow.kind === 'calibration' || vow.status === 'cancelled') return null;
  if (vow.status === 'done') return 'kept';
  if (vow.status === 'failed') return 'broken';
  if (vow.kind === 'emergency') return 'urgent';
  if (vow.kind === 'penalty') return 'reckoning';
  return vow.kind === 'daily' ? 'today' : 'sworn';
}

/** Non-empty groups in display order; Calibration measurements and cancelled vows are hidden. */
export function groupVows(vows: readonly Quest[]): VowGroup[] {
  return GROUP_ORDER.map((key) => ({ key, label: GROUP_LABEL[key], vows: vows.filter((vow) => groupOf(vow) === key) })).filter((group) => group.vows.length > 0);
}

const REP_UNITS: Partial<Record<QuestType, string>> = {
  pushup: 'push-ups',
  squat: 'squats',
  situp: 'sit-ups',
  jumpingjack: 'jumping jacks',
  punch: 'punches',
  steps: 'steps',
  run: 'km',
  workout: 'min',
  sleep: 'h',
};
const TIMED: readonly QuestType[] = ['jail', 'read', 'meditate'];
const PHONE_COUNTED: readonly QuestType[] = ['squat', 'situp', 'jumpingjack', 'pushup'];
const HEALTH: readonly QuestType[] = ['run', 'steps', 'workout', 'sleep', 'bedtime', 'lightsoutby', 'punch'];

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const trim = (n: number): string => String(Math.round(n * 10) / 10);

/** "3 / 25 squats", "0:20 / 5:00", "Asleep by 23:30"… */
export function progressLabel(vow: Quest): string {
  if (TIMED.includes(vow.type)) return `${clock(vow.progress)} / ${clock(vow.target)}`;
  switch (vow.type) {
    case 'photo':
      return 'Photo proof';
    case 'gate':
      return 'Check in by photo';
    case 'quiz':
      return 'Three questions';
    case 'lightsout':
      return 'Room dark';
    case 'lightsoutby':
      return vow.targetTime ? `Asleep by ${vow.targetTime}` : 'Asleep on time';
    case 'bedtime':
      return vow.targetTime ? `In bed within 30 min of ${vow.targetTime}` : 'In bed on time';
    default:
      return `${trim(vow.progress)} / ${trim(vow.target)} ${REP_UNITS[vow.type] ?? ''}`.trim();
  }
}

export function proofSource(type: QuestType): string {
  switch (type) {
    case 'pushup':
      return 'Rep pad · phone · Watch';
    case 'squat':
    case 'situp':
    case 'jumpingjack':
      return 'Phone · Watch';
    case 'punch':
      return 'Watch';
    case 'jail':
      return 'Phone lock';
    case 'read':
      return 'Phone lock + trial';
    case 'meditate':
      return 'Button + silence';
    case 'lightsout':
      return 'Light sensor';
    case 'lightsoutby':
    case 'bedtime':
    case 'sleep':
      return 'Watch sleep';
    case 'run':
    case 'steps':
    case 'workout':
      return 'Apple Health';
    case 'photo':
    case 'gate':
      return 'Photo · vision AI';
    case 'quiz':
      return 'Trial';
  }
}

export type VowAction = 'begin' | 'photo' | 'quiz' | 'readTrial' | 'none';

/** What the person can do about an active vow right now. */
export function vowAction(vow: Quest): VowAction {
  if (vow.status !== 'active') return 'none';
  if (vow.type === 'photo' || vow.type === 'gate') return 'photo';
  if (vow.type === 'quiz') return 'quiz';
  if (vow.type === 'read' && vow.progress >= vow.target) return 'readTrial';
  if (HEALTH.includes(vow.type)) return 'none';
  return 'begin';
}

export const isPhoneCounted = (type: QuestType): boolean => PHONE_COUNTED.includes(type);

export function fraction(vow: Quest): number {
  if (vow.status === 'done') return 1;
  return Math.max(0, Math.min(1, vow.progress / vow.target));
}

export function vowTone(vow: Quest): 'red' | 'gold' | undefined {
  if (vow.status === 'done') return 'gold';
  if (vow.status === 'failed' || vow.kind === 'emergency' || vow.kind === 'penalty') return 'red';
  return undefined;
}

export const statLabel = (vow: Quest): string => STAT_LABELS[vow.stat];

/** "7 h 13 m" */
export function hoursMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} m`;
}
