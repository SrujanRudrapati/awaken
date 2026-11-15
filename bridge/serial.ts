/**
 * Home Base serial bridge.
 *
 *   npm run bridge                 # SERIAL_PORT from .env.local, e.g. /dev/cu.usbmodem1101
 *   SERIAL_PORT=mock npm run bridge  # no hardware: a fake Home Base streams simulator push-ups
 *
 * Arduino → laptop: one JSON line per 100 ms @115200 → Reading (source 'homebase')
 *   → batched (≤5) POST `${APP_URL}/api/readings`.
 * Laptop → Arduino: HTTP :3001 `POST /cmd` (body `LOCK` or `{"cmd":"LOCK"}`) → validated
 *   DeviceCommand + '\n' written to the port. `GET /health` reports the port state.
 * The port reopens automatically after unplug / errors.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ReadlineParser } from '@serialport/parser-readline';
import { SerialPort, SerialPortMock } from 'serialport';
import { z } from 'zod';
import { DeviceCommandSchema, ReadingSchema, type DeviceCommand, type Reading } from '../lib/schemas';
import { SAMPLE_MS, readingAt } from './simulator';

export const BAUD_RATE = 115_200;
export const CMD_PORT = 3001;
export const MAX_BATCH = 5;
/** Readings kept while the app is unreachable; oldest are dropped beyond this. */
export const MAX_BUFFER = 100;
const FLUSH_MS = 200;
const RECONNECT_MS = 2_000;
const POST_TIMEOUT_MS = 1_000;
const MAX_BODY_BYTES = 1_024;
const MOCK_PATH = '/dev/mock-homebase';
const DEFAULT_APP_URL = 'http://localhost:3000';

const log = (msg: string): void => console.log(`[bridge] ${msg}`);
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── Arduino → Reading ───────────────────────────────────────────────────────

/** One serial line → Reading with source 'homebase', or null if it isn't a valid reading. */
export function parseLine(line: string): Reading | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null; // boot banner / debug prints
  try {
    const parsed = ReadingSchema.safeParse({ ...JSON.parse(trimmed), source: 'homebase' });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ── Batching ────────────────────────────────────────────────────────────────

export type PostBatch = (batch: Reading[]) => Promise<void>;

/** Buffers readings and POSTs them in order, ≤ MAX_BATCH per request, one request at a time. */
export class ReadingBatcher {
  private buffer: Reading[] = [];
  private inFlight = false;
  private failing = false;

  constructor(private readonly post: PostBatch) {}

  get pending(): number {
    return this.buffer.length;
  }

  add(reading: Reading): void {
    this.buffer = [...this.buffer, reading].slice(-MAX_BUFFER);
    if (this.buffer.length >= MAX_BATCH) void this.flush();
  }

  /** Sends one batch if none is in flight. Failed batches are dropped (readings are realtime). */
  async flush(): Promise<void> {
    if (this.inFlight || this.buffer.length === 0) return;
    const batch = this.buffer.slice(0, MAX_BATCH);
    this.buffer = this.buffer.slice(MAX_BATCH);
    this.inFlight = true;
    try {
      await this.post(batch);
      if (this.failing) log('app reachable again');
      this.failing = false;
    } catch (error) {
      if (!this.failing) log(`POST /api/readings failed: ${errorText(error)} (will keep trying)`);
      this.failing = true;
    } finally {
      this.inFlight = false;
    }
    if (this.buffer.length >= MAX_BATCH) await this.flush();
  }
}

export function httpPoster(appUrl: string): PostBatch {
  const url = `${appUrl}/api/readings`;
  return async (batch) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  };
}

// ── Commands (HTTP :3001 → serial) ──────────────────────────────────────────

const CommandBodySchema = z.object({ cmd: DeviceCommandSchema });

type ParsedCommand = { ok: true; cmd: DeviceCommand } | { ok: false; error: string };

/** Accepts a raw command (`LOCK`) or JSON (`{"cmd":"LOCK"}`). */
export function parseCommandBody(body: string): ParsedCommand {
  const text = body.trim();
  if (!text.startsWith('{')) {
    const parsed = DeviceCommandSchema.safeParse(text);
    return parsed.success ? { ok: true, cmd: parsed.data } : { ok: false, error: `Unknown command: ${text}` };
  }
  try {
    const parsed = CommandBodySchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { ok: true, cmd: parsed.data.cmd }
      : { ok: false, error: z.prettifyError(parsed.error) };
  } catch {
    return { ok: false, error: 'Body must be a command or valid JSON {"cmd": ...}' };
  }
}

export interface CommandTarget {
  isOpen(): boolean;
  write(cmd: DeviceCommand): Promise<void>;
}

function reply(res: ServerResponse, status: number, data: unknown, error: string | null = null): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: error === null, data, error }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function createCommandServer(target: CommandTarget): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      reply(res, 200, { serial: target.isOpen() ? 'open' : 'closed' });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/cmd') {
      reply(res, 404, null, 'Use POST /cmd or GET /health');
      return;
    }
    readBody(req)
      .then(async (body) => {
        const parsed = parseCommandBody(body);
        if (!parsed.ok) return reply(res, 400, null, parsed.error);
        if (!target.isOpen()) return reply(res, 503, null, 'Serial port not open');
        await target.write(parsed.cmd);
        reply(res, 200, { sent: parsed.cmd });
      })
      .catch((error: unknown) => reply(res, 500, null, errorText(error)));
  });
}

// ── Serial port with auto-reconnect ─────────────────────────────────────────

type AnyPort = SerialPort | SerialPortMock;

export interface SerialLink extends CommandTarget {
  close(): void;
}

export function connectSerial(path: string, onLine: (line: string) => void): SerialLink {
  const mock = path === 'mock';
  let port: AnyPort | null = null;
  let stopped = false;
  let warned = false;

  const open = (): void => {
    if (stopped) return;
    const next: AnyPort = mock
      ? new SerialPortMock({ path: MOCK_PATH, baudRate: BAUD_RATE, autoOpen: false })
      : new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    next.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', onLine);
    next.on('close', () => {
      if (stopped) return;
      log(`serial ${path} closed — reconnecting`);
      setTimeout(open, RECONNECT_MS);
    });
    next.on('error', (error) => log(`serial error: ${errorText(error)}`));
    next.open((error) => {
      if (error) {
        if (!warned) log(`cannot open ${path}: ${error.message} — retrying every ${RECONNECT_MS / 1000} s`);
        warned = true;
        setTimeout(open, RECONNECT_MS);
        return;
      }
      warned = false;
      port = next;
      log(`serial ${path} open @${BAUD_RATE}`);
      if (mock && next instanceof SerialPortMock) startFakeHomeBase(next);
    });
  };

  open();

  return {
    isOpen: () => port?.isOpen ?? false,
    write: (cmd) =>
      new Promise((resolve, reject) => {
        if (!port?.isOpen) return reject(new Error('Serial port not open'));
        port.write(`${cmd}\n`, (error) => (error ? reject(error) : resolve()));
      }),
    close: () => {
      stopped = true;
      if (port?.isOpen) port.close();
    },
  };
}

/** SERIAL_PORT=mock: streams simulator pad push-ups as Arduino JSON and logs received commands. */
function startFakeHomeBase(port: SerialPortMock): void {
  let tick = 0;
  let seenBytes = 0;
  const timer = setInterval(() => {
    if (!port.isOpen || !port.port) return clearInterval(timer);
    const firmwareJson = { ...readingAt('pushup', tick * SAMPLE_MS), source: undefined }; // Arduino sends no source
    tick += 1;
    port.port.emitData(`${JSON.stringify(firmwareJson)}\n`);

    const recorded: string = Buffer.from(port.port.recording).toString('utf8');
    const fresh = recorded.slice(seenBytes);
    seenBytes = recorded.length;
    fresh.split('\n').filter(Boolean).forEach((cmd) => log(`[fake home base] received ${cmd}`));
  }, SAMPLE_MS);
}

// ── Main ────────────────────────────────────────────────────────────────────

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // optional
  }
}

function main(): void {
  loadEnv();
  const path = process.env.SERIAL_PORT;
  if (!path) {
    console.error('[bridge] Set SERIAL_PORT (ls /dev/cu.usb*) or SERIAL_PORT=mock in .env.local');
    process.exit(1);
  }
  if (path === 'mock') SerialPortMock.binding.createPort(MOCK_PATH, { echo: false, record: true });

  const appUrl = process.env.APP_URL || DEFAULT_APP_URL;
  const batcher = new ReadingBatcher(httpPoster(appUrl));
  let badLines = 0;
  const link = connectSerial(path, (line) => {
    const reading = parseLine(line);
    if (reading) return batcher.add(reading);
    badLines += 1;
    if (badLines === 1 || badLines % 100 === 0) log(`ignored non-reading line (#${badLines}): ${line.slice(0, 80)}`);
  });
  setInterval(() => void batcher.flush(), FLUSH_MS);

  const server = createCommandServer(link);
  server.listen(CMD_PORT, () => log(`commands on http://localhost:${CMD_PORT}/cmd → ${path}; readings → ${appUrl}`));

  const shutdown = (): void => {
    link.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('serial.ts')) main();
