/**
 * Send a command to the Home Base via the serial bridge (`POST ${DEVICE_URL}/cmd`).
 * Fire-and-forget by design: the game must keep running when the Arduino or bridge is
 * absent, so send() never throws and is silent when the bridge isn't running.
 */
import { DeviceCommandSchema, type DeviceCommand } from './schemas';

const DEFAULT_DEVICE_URL = 'http://localhost:3001';
export const DEVICE_TIMEOUT_MS = 1_000;

/** Resolves true if the bridge accepted the command, false otherwise. Never rejects. */
export async function send(cmd: DeviceCommand): Promise<boolean> {
  const parsed = DeviceCommandSchema.safeParse(cmd);
  if (!parsed.success) {
    console.error(`[device] refusing invalid command ${JSON.stringify(cmd)}`); // a code bug, not an outage
    return false;
  }
  try {
    const res = await fetch(`${process.env.DEVICE_URL || DEFAULT_DEVICE_URL}/cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: parsed.data }),
      signal: AbortSignal.timeout(DEVICE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false; // bridge not running / unreachable: silent no-op
  }
}

/** Sends commands in order (e.g. BUZZ then SEG). Resolves true only if all were accepted. */
export async function sendAll(cmds: readonly DeviceCommand[]): Promise<boolean> {
  let allOk = true;
  for (const cmd of cmds) {
    allOk = (await send(cmd)) && allOk;
  }
  return allOk;
}
