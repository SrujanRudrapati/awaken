/**
 * Pure logic for `npm run hw:check`: tracks every Home Base sensor from raw firmware lines
 * and says, per sensor, whether it is absent (null), idle, or has visibly responded.
 */
export type SensorKey = 'pad' | 'btn' | 'light' | 'snd' | 'accel' | 'jail' | 'servo';

export interface SensorSpec {
  key: SensorKey;
  label: string;
  /** What to do to prove it works. */
  action: string;
  /** Range (max − min) that counts as "responded". */
  responds: number;
}

export const SENSORS: readonly SensorSpec[] = [
  { key: 'pad', label: 'Push-up pad (D6)', action: 'press the micro switch', responds: 1 },
  { key: 'btn', label: 'Button (D2)', action: 'press the button', responds: 1 },
  { key: 'light', label: 'Light (A0)', action: 'cover the sensor with your hand', responds: 200 },
  { key: 'snd', label: 'Sound (A1)', action: 'clap near the mic', responds: 150 },
  { key: 'accel', label: 'Accel MMA7660 (0x4C)', action: 'tilt / shake the board', responds: 0.6 },
  { key: 'jail', label: 'IR reflective (D7, optional)', action: 'hold a phone over it', responds: 1 },
  { key: 'servo', label: 'Servo (D5, optional)', action: 'sent LOCK/UNLOCK at start', responds: 1 },
];

interface Track {
  value: string;
  min: number;
  max: number;
  seen: boolean;
  absent: boolean;
}

export interface HwState {
  boot: string | null;
  lines: number;
  tracks: Record<SensorKey, Track>;
  acks: string[];
}

export function createHwState(): HwState {
  const tracks = Object.fromEntries(
    SENSORS.map((s) => [s.key, { value: '—', min: Infinity, max: -Infinity, seen: false, absent: false }]),
  ) as Record<SensorKey, Track>;
  return { boot: null, lines: 0, tracks, acks: [] };
}

function record(track: Track, numeric: number | null, shown: string): void {
  track.seen = true;
  track.value = shown;
  track.absent = numeric === null;
  if (numeric === null) return;
  track.min = Math.min(track.min, numeric);
  track.max = Math.max(track.max, numeric);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Feeds one raw serial line. Mutates and returns the (script-local) state. */
export function ingest(state: HwState, line: string): HwState {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return state;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return state;
  }
  if ('boot' in data) {
    state.boot = trimmed;
    return state;
  }
  if ('ack' in data) {
    state.acks = [...state.acks.slice(-5), `${String(data.ack)} → ${data.ok ? 'ok' : 'FAILED'}`];
    return state;
  }
  if (num(data.t) === null) return state;
  state.lines += 1;
  const { tracks } = state;
  for (const key of ['pad', 'btn', 'light', 'snd', 'jail'] as const) record(tracks[key], num(data[key]), String(data[key]));
  const [ax, ay, az] = [num(data.ax), num(data.ay), num(data.az)];
  const magnitude = ax === null || ay === null || az === null ? null : Math.hypot(ax, ay, az);
  record(tracks.accel, ax, ax === null ? 'null' : `x ${ax} y ${ay} z ${az} |g| ${magnitude?.toFixed(2)}`);
  const servo = data.servo;
  record(tracks.servo, servo === 'locked' ? 1 : servo === 'unlocked' ? 0 : null, String(servo));
  return state;
}

export type SensorStatus = 'waiting' | 'absent' | 'idle' | 'ok';

export function statusOf(state: HwState, spec: SensorSpec): SensorStatus {
  const track = state.tracks[spec.key];
  if (!track.seen) return 'waiting';
  if (track.absent && track.max === -Infinity) return 'absent';
  return track.max - track.min >= spec.responds ? 'ok' : 'idle';
}

const ICON: Record<SensorStatus, string> = { waiting: '…', absent: '∅', idle: '·', ok: '✓' };

export function render(state: HwState): string {
  const rows = SENSORS.map((spec) => {
    const track = state.tracks[spec.key];
    const status = statusOf(state, spec);
    const range = track.max === -Infinity ? '' : ` [${+track.min.toFixed(2)}…${+track.max.toFixed(2)}]`;
    const hint = status === 'idle' ? `  ← ${spec.action}` : status === 'absent' ? '  (null: not fitted/enabled)' : '';
    return `${ICON[status]} ${spec.label.padEnd(30)} ${track.value}${range}${hint}`;
  });
  return [
    `boot: ${state.boot ?? '(not seen — press RESET on the board to see it)'}`,
    `readings: ${state.lines}`,
    ...rows,
    `acks: ${state.acks.join(' · ') || '—'}`,
  ].join('\n');
}
