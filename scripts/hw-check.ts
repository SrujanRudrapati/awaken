/**
 * npm run hw:check — live Home Base readings, sensor by sensor, straight from SERIAL_PORT.
 * Stop `npm run bridge` first (only one program can hold the port).
 * On connect it sends the CFG for optional hardware (HOMEBASE_IR / HOMEBASE_SERVO), shows
 * OATH on the display, chimes, and (if a servo is enabled) LOCKs then UNLOCKs.
 *
 *   npm run hw:check            # live panel until Ctrl+C
 *   npm run hw:check -- --once  # print one snapshot after 3 s and exit (non-interactive)
 */
import { ReadlineParser } from '@serialport/parser-readline';
import { SerialPort } from 'serialport';
import { NUDGE_MS, configCommands } from '../bridge/serial';
import { createHwState, ingest, render } from '../bridge/hwCheck';

const BAUD = 115_200;
const REFRESH_MS = 250;
const ONCE_AFTER_MS = 6_000; // the R4 WiFi stays silent ~3 s after the port opens
const SERVO_TEST_MS = 1_000;
const COMMAND_GAP_MS = 120;

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local
  }
}

function main(): void {
  loadEnv();
  const path = process.env.SERIAL_PORT;
  if (!path || path === 'mock') {
    console.error('[hw:check] Set SERIAL_PORT to the real board (ls /dev/cu.usbmodem*) in .env.local');
    process.exit(1);
  }
  const once = process.argv.includes('--once');
  const state = createHwState();
  const port = new SerialPort({ path, baudRate: BAUD });
  const queue: string[] = [];
  const send = (cmd: string) => queue.push(cmd);
  /** One command per COMMAND_GAP_MS, each followed by the '\n' nudge the R4 WiFi bridge needs. */
  setInterval(() => {
    const cmd = queue.shift();
    if (!cmd || !port.isOpen) return;
    port.write(`${cmd}\n`);
    setTimeout(() => port.isOpen && port.write('\n'), NUDGE_MS);
  }, COMMAND_GAP_MS);
  let setupDone = false;
  const setup = (): void => {
    if (setupDone) return;
    setupDone = true;
    configCommands(process.env).forEach(send);
    send('SEG:OATH');
    send('BUZZ:chime');
    if (process.env.HOMEBASE_SERVO === '1') {
      send('LOCK');
      setTimeout(() => send('UNLOCK'), SERVO_TEST_MS);
    }
  };

  port.on('error', (error) => {
    console.error(`[hw:check] ${error.message}${/busy|lock/i.test(error.message) ? ' — is `npm run bridge` running? Stop it first.' : ''}`);
    process.exit(1);
  });
  port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (line: string) => {
    ingest(state, line);
    setup(); // only once the board is actually talking
  });

  if (once) {
    setTimeout(() => {
      console.log(render(state));
      port.close(() => process.exit(0));
    }, ONCE_AFTER_MS);
    return;
  }
  setInterval(() => {
    process.stdout.write(`\x1b[2J\x1b[H[hw:check] ${path} @${BAUD} — Ctrl+C to quit\n\n${render(state)}\n`);
  }, REFRESH_MS);
  process.on('SIGINT', () => port.close(() => process.exit(0)));
}

main();
