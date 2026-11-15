/**
 * Sensor simulator — never blocked by hardware.
 *
 *   npm run sim [pushup|squat|jail|idle]
 *
 *   pushup  Home Base pad: chest presses the pad once per 1.5 s, with one-sample contact
 *           bounce on every press and release (the verifier must debounce it).
 *   squat   iPhone armband (source 'phone'): ay swings −1 g → −0.2 g once per 2 s;
 *           every 4th squat only reaches half depth.
 *   jail    Home Base IR: phone in the jail for 30 s, then removed.
 *   idle    Home Base at rest.
 *
 * POSTs one Reading every 100 ms to `${APP_URL}/api/readings`.
 * The waveform functions are pure and exported so verifier tests replay exactly what
 * the simulator sends.
 */
import { ReadingSchema, type Bit, type Reading } from '../lib/schemas';

export const MODES = ['pushup', 'squat', 'jail', 'idle'] as const;
export type Mode = (typeof MODES)[number];

export const SAMPLE_MS = 100;

// Push-up pad: per 1.5 s rep (15 samples), pressed from 0.5 s to 1.3 s, bouncing once each edge.
export const PUSHUP_REP_MS = 1_500;
const PAD_PATTERN: readonly Bit[] = [0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0];

// Squat (phone armband): ay rests at −1 g, reaches −0.2 g at the bottom of a full squat.
export const SQUAT_REP_MS = 2_000;
export const SQUAT_REST_G = -1;
export const SQUAT_FULL_DEPTH_G = 0.8;
export const SQUAT_SHALLOW_EVERY = 4;

// Phone Jail: jail=1 for 30 s, then 0.
export const JAIL_DURATION_MS = 30_000;

const REQUEST_TIMEOUT_MS = 1_000;
const DEFAULT_APP_URL = 'http://localhost:3000';

const HOMEBASE_READING: Reading = {
  t: 0,
  source: 'homebase',
  pad: 0,
  jail: 0,
  btn: 0,
  light: 500,
  snd: 100,
};

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

function padAt(tMs: number): Bit {
  const index = Math.floor((tMs % PUSHUP_REP_MS) / SAMPLE_MS);
  return PAD_PATTERN[index] ?? 0;
}

/** Depth (g) of squat `repNumber` (1-based): every 4th is half depth. */
export function squatDepth(repNumber: number): number {
  const full = SQUAT_FULL_DEPTH_G;
  return repNumber % SQUAT_SHALLOW_EVERY === 0 ? full / 2 : full;
}

function squatReading(tMs: number): Reading {
  const repNumber = Math.floor(tMs / SQUAT_REP_MS) + 1;
  const phase = (tMs % SQUAT_REP_MS) / SQUAT_REP_MS; // 0 standing → 0.5 bottom → 1 standing
  const offset = (squatDepth(repNumber) * (1 - Math.cos(2 * Math.PI * phase))) / 2;
  const ay = SQUAT_REST_G + offset;
  return {
    t: tMs,
    source: 'phone',
    ax: round(0.05 * Math.sin(tMs / 300)), // small sway
    ay: round(ay),
    az: round(Math.sqrt(Math.max(0, 1 - ay * ay))), // gravity moves onto z as the arm tilts
  };
}

/** The reading the simulator sends at `tMs` ms after start. */
export function readingAt(mode: Mode, tMs: number): Reading {
  switch (mode) {
    case 'pushup':
      return { ...HOMEBASE_READING, t: tMs, pad: padAt(tMs) };
    case 'squat':
      return squatReading(tMs);
    case 'jail':
      return { ...HOMEBASE_READING, t: tMs, jail: tMs < JAIL_DURATION_MS ? 1 : 0 };
    case 'idle':
      return { ...HOMEBASE_READING, t: tMs };
  }
}

/** All readings for the first `durationMs` ms, sampled every 100 ms. */
export function waveform(mode: Mode, durationMs: number): Reading[] {
  const count = Math.floor(durationMs / SAMPLE_MS);
  return Array.from({ length: count }, (_, i) => readingAt(mode, i * SAMPLE_MS));
}

export function parseMode(arg: string | undefined): Mode {
  if (arg === undefined) return 'idle';
  if ((MODES as readonly string[]).includes(arg)) return arg as Mode;
  throw new Error(`Unknown mode "${arg}". Use one of: ${MODES.join('|')}`);
}

/** Human log line when a rep/phase boundary is crossed between two sample times, else null. */
function eventBetween(mode: Mode, prevT: number, t: number): string | null {
  if (mode === 'pushup') {
    const done = Math.floor(t / PUSHUP_REP_MS);
    if (done === Math.floor(prevT / PUSHUP_REP_MS)) return null;
    return `pad rep #${done} sent (with contact bounce)`;
  }
  if (mode === 'squat') {
    const done = Math.floor(t / SQUAT_REP_MS);
    if (done === Math.floor(prevT / SQUAT_REP_MS)) return null;
    const shallow = squatDepth(done) < SQUAT_FULL_DEPTH_G;
    return `phone squat #${done} sent — ${shallow ? 'SHALLOW' : 'full'}${done <= 2 ? ' (calibration)' : ''}`;
  }
  if (mode === 'jail' && prevT < JAIL_DURATION_MS && t >= JAIL_DURATION_MS) {
    return `phone removed (jail=0) after ${JAIL_DURATION_MS / 1000} s`;
  }
  return null;
}

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // optional — APP_URL falls back to localhost
  }
}

async function send(url: string, reading: Reading): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ReadingSchema.parse(reading)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

function run(mode: Mode): void {
  loadEnv();
  const url = `${process.env.APP_URL || DEFAULT_APP_URL}/api/readings`;
  console.log(`[sim] mode=${mode} → POST ${url} every ${SAMPLE_MS} ms (Ctrl-C to stop)`);
  if (mode === 'jail') console.log('[sim] phone locked (jail=1)');

  let tick = 0;
  let inFlight = false;
  let failing = false;

  setInterval(() => {
    const t = tick * SAMPLE_MS;
    tick += 1;
    const event = tick > 1 ? eventBetween(mode, t - SAMPLE_MS, t) : null;
    if (event) console.log(`[sim] ${event}`);
    if (inFlight) return; // server slow: drop this sample rather than pile up requests
    inFlight = true;
    send(url, readingAt(mode, t))
      .then(() => {
        if (failing) console.log('[sim] server reachable again');
        failing = false;
      })
      .catch((error: unknown) => {
        if (!failing) console.error(`[sim] POST failed: ${error instanceof Error ? error.message : error}`);
        failing = true; // log once per outage, not 10×/s
      })
      .finally(() => {
        inFlight = false;
      });
  }, SAMPLE_MS);
}

// Run only when executed directly (`tsx bridge/simulator.ts`), not when imported by tests.
if (process.argv[1]?.endsWith('simulator.ts')) {
  try {
    run(parseMode(process.argv[2]));
  } catch (error) {
    console.error(`[sim] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
