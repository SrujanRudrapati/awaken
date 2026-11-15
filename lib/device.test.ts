import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceCommand } from './schemas';
import { send, sendAll } from './device';

describe('device.send', () => {
  let server: Server | null = null;
  let bodies: string[] = [];

  beforeEach(() => {
    bodies = [];
  });
  afterEach(() => {
    server?.close();
    server = null;
    delete process.env.DEVICE_URL;
  });

  async function fakeBridge(status = 200): Promise<void> {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        bodies.push(body);
        res.writeHead(status).end('{}');
      });
    });
    server.listen(0);
    await once(server, 'listening');
    process.env.DEVICE_URL = `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  it('POSTs {cmd} to the bridge and resolves true', async () => {
    await fakeBridge();

    await expect(send('BUZZ:chime')).resolves.toBe(true);
    expect(JSON.parse(bodies[0])).toEqual({ cmd: 'BUZZ:chime' });
  });

  it('resolves false (silently) when the bridge is not running', async () => {
    const error = vi.spyOn(console, 'error');
    process.env.DEVICE_URL = 'http://localhost:1'; // nothing listens on port 1

    await expect(send('LOCK')).resolves.toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('resolves false when the bridge rejects the command (e.g. port closed)', async () => {
    await fakeBridge(503);

    await expect(send('UNLOCK')).resolves.toBe(false);
  });

  it('refuses invalid commands without calling the bridge', async () => {
    await fakeBridge();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(send('SEG:TOOLONG' as DeviceCommand)).resolves.toBe(false);
    expect(bodies).toEqual([]);
    error.mockRestore();
  });

  it('sendAll sends in order', async () => {
    await fakeBridge();

    await expect(sendAll(['BUZZ:chime', 'SEG:LVUP'])).resolves.toBe(true);
    expect(bodies.map((b) => JSON.parse(b).cmd)).toEqual(['BUZZ:chime', 'SEG:LVUP']);
  });
});
