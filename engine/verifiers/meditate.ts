/**
 * Meditate (button D2 + sound A0): hold the button and stay quiet for `target` seconds.
 *
 * - The first BASELINE_SAMPLES sound readings set the room's quiet baseline (median).
 * - "Calm" = btn=1 and snd ≤ baseline + SOUND_MARGIN. Time counts while calm, and for up to
 *   GRACE_MS after the last calm reading (a cough or a slipped thumb is forgiven).
 * - A longer break pauses the timer and reports rep.rejected once ('hold the button' / 'too loud');
 *   it never fails the quest — the deadline does that.
 * - Each new whole second: `progress` + a SEG countdown. Readings without btn+snd are ignored.
 */
import type { Reading } from '../../lib/schemas';
import { segNumber } from '../progression';
import type { Verifier, VerifierEvent, VerifierQuest } from './types';

export const BASELINE_SAMPLES = 10;
export const SOUND_MARGIN = 60;
export const GRACE_MS = 2_000;
/** Longest gap between two readings that still counts as held time (bridge hiccups). */
const MAX_STEP_MS = 500;
export const REASON_RELEASED = 'hold the button';
export const REASON_LOUD = 'too loud';

export class MeditateVerifier implements Verifier {
  private readonly calibration: number[] = [];
  private baseline: number | null = null;
  private heldMs: number;
  private lastCalmT: number | null = null;
  private prevT: number | null = null;
  private warned = false;
  private finished = false;

  constructor(private readonly quest: VerifierQuest) {
    this.heldMs = quest.progress * 1_000;
  }

  push(reading: Reading): VerifierEvent[] {
    if (this.finished || reading.btn === undefined || reading.snd === undefined) return [];
    if (this.baseline === null) return this.calibrate(reading.snd);
    if (this.prevT !== null && reading.t < this.prevT) this.prevT = null; // device rebooted

    const loud = reading.snd > this.baseline + SOUND_MARGIN;
    const calm = reading.btn === 1 && !loud;
    if (calm) {
      this.lastCalmT = reading.t;
      this.warned = false;
    }
    const counting = this.lastCalmT !== null && reading.t - this.lastCalmT <= GRACE_MS;
    const before = Math.floor(this.heldMs / 1_000);
    if (counting && this.prevT !== null) this.heldMs += Math.min(MAX_STEP_MS, reading.t - this.prevT);
    this.prevT = reading.t;

    const events: VerifierEvent[] = [];
    if (!counting && this.lastCalmT !== null && !this.warned) {
      this.warned = true;
      events.push({ type: 'rep.rejected', reason: reading.btn === 1 ? REASON_LOUD : REASON_RELEASED });
    }
    const held = Math.min(this.quest.target, Math.floor(this.heldMs / 1_000));
    if (held >= this.quest.target) {
      this.finished = true;
      return [...events, { type: 'progress', value: this.quest.target }, { type: 'done' }];
    }
    if (held > before) events.push({ type: 'progress', value: held }, { type: 'device', cmd: segNumber(this.quest.target - held) });
    return events;
  }

  private calibrate(snd: number): VerifierEvent[] {
    this.calibration.push(snd);
    if (this.calibration.length < BASELINE_SAMPLES) return [];
    const sorted = [...this.calibration].sort((a, b) => a - b);
    this.baseline = sorted[Math.floor(sorted.length / 2)];
    return [{ type: 'device', cmd: segNumber(this.quest.target - this.quest.progress) }];
  }
}
