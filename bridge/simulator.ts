/**
 * Sensor simulator — never blocked by hardware (BACKEND_STEPS Phase 3).
 *
 *   npm run sim [pushup|squat|jail|idle]
 *
 * POSTs one Reading every 100 ms to `${APP_URL}/api/readings`.
 * The waveform functions are pure and exported so verifier tests (Phase 4)
 * can replay exactly what the simulator sends.
 */
import { ReadingSchema, type Reading } from '../lib/schemas';

export const MODES = ['pushup', 'squat', 'jail', 'idle'] as const;
export type Mode = (typeof MODES)[number];

export const SAMPLE_MS = 100;

// Push-up: dist 40 → 10 → 40 cm, 1.5 s per rep; every 4th rep only reaches 22 cm.
export const PUSHUP_REP_MS = 1_500;
export const PUSHUP_TOP_CM = 40;
export const PUSHUP_FULL_CM = 10;
export const PUSHUP_SHALLOW_CM = 22;
export const PUSHUP_SHALLOW_EVERY = 4;

// Squat: az rests at 1 g and peaks ~1.8 g once every 2 s.
export const SQUAT_REP_MS = 2_000;
export const SQUAT_PEAK_G = 1.8;
const SQUAT_PEAK_WIDTH_MS = 250; // gaussian σ of the peak

// Phone Jail: jail=1 for 30 s, then 0.
export const JAIL_DURATION_MS = 30_000;

const REQUEST_TIMEOUT_MS = 1_000;
const DEFAULT_APP_URL = 'http://localhost:3000';

const BASE_READING: Reading = {
  t: 0,
  dist: PUSHUP_TOP_CM,
  ax: 0,
  ay: 0,
  az: 1,
  jail: 0,
  touch: 0,
  light: 500,
  snd: 100,
  bottle: 0,
  btn: 0,
};

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

/** Bottom distance (cm) of push-up rep `repNumber` (1-based). */
export function pushupBottom(repNumber: number): number {
  return repNumber % PUSHUP_SHALLOW_EVERY === 0 ? PUSHUP_SHALLOW_CM : PUSHUP_FULL_CM;
}

function pushupDist(tMs: number): number {
  const repNumber = Math.floor(tMs / PUSHUP_REP_MS) + 1;
  const phase = (tMs % PUSHUP_REP_MS) / PUSHUP_REP_MS; // 0 top → 0.5 bottom → 1 top
  const depth = PUSHUP_TOP_CM - pushupBottom(repNumber);
  return round(PUSHUP_TOP_CM - (depth * (1 - Math.cos(2 * Math.PI * phase))) / 2);
}

function squatAz(tMs: number): number {
  const offset = (tMs % SQUAT_REP_MS) - SQUAT_REP_MS / 2; // peak mid-cycle
  return round(1 + (SQUAT_PEAK_G - 1) * Math.exp(-((offset / SQUAT_PEAK_WIDTH_MS) ** 2)));
}

/** The reading the simulator sends at `tMs` ms after start. */
export function readingAt(mode: Mode, tMs: number): Reading {
  const base = { ...BASE_READING, t: tMs };
  switch (mode) {
    case 'pushup':
      return { ...base, dist: pushupDist(tMs) };
    case 'squat':
      return { ...base, az: squatAz(tMs) };
    case 'jail':
      return { ...base, jail: tMs < JAIL_DURATION_MS ? 1 : 0 };
    case 'idle':
      return base;
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
    const bottom = pushupBottom(done);
    return `rep #${done} sent — ${bottom === PUSHUP_SHALLOW_CM ? 'SHALLOW' : 'full'} (${bottom} cm)`;
  }
  if (mode === 'squat') {
    const done = Math.floor(t / SQUAT_REP_MS);
    if (done === Math.floor(prevT / SQUAT_REP_MS)) return null;
    return `squat #${done} sent — peak ${SQUAT_PEAK_G} g`;
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
