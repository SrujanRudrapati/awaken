import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SerialPortMock } from 'serialport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceCommand, Reading } from '../lib/schemas';
import {
  MAX_BATCH,
  MAX_BUFFER,
  NUDGE_MS,
  ReadingBatcher,
  configCommands,
  connectSerial,
  createCommandServer,
  failedAck,
  isBootLine,
  parseCommandBody,
  parseLine,
  type CommandTarget,
} from './serial';

const reading = (t: number): Reading => ({ t, source: 'homebase', pad: 0 });

describe('parseLine', () => {
  it('turns firmware JSON into a homebase Reading, stripping unknown fields', () => {
    expect(parseLine('{"t":100,"pad":1,"jail":0,"btn":0,"light":512,"snd":80,"junk":5}\r')).toEqual({
      t: 100, source: 'homebase', pad: 1, jail: 0, btn: 0, light: 512, snd: 80,
    });
  });

  it('forces source to homebase even if the firmware sends something else', () => {
    expect(parseLine('{"t":1,"source":"phone"}')?.source).toBe('homebase');
  });

  it.each(['Home Base v1 booting...', '{"t":1,', '{"t":-5}', '{"t":1,"pad":2}', ''])('ignores %j', (line) => {
    expect(parseLine(line)).toBeNull();
  });
});

describe('ReadingBatcher', () => {
  it('posts in order, at most 5 readings per request', async () => {
    const batches: number[][] = [];
    const batcher = new ReadingBatcher(async (b) => {
      batches.push(b.map((r) => r.t));
    });

    for (let t = 0; t < 12; t++) batcher.add(reading(t));
    await vi.waitFor(() => expect(batches).toHaveLength(2)); // full batches go immediately
    await batcher.flush(); // the 200 ms timer's job in the bridge

    expect(batches).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11]]);
    expect(batcher.pending).toBe(0);
  });

  it('never overlaps requests', async () => {
    let active = 0;
    let maxActive = 0;
    const batcher = new ReadingBatcher(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });

    for (let t = 0; t < 20; t++) batcher.add(reading(t));
    await batcher.flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(maxActive).toBe(1);
  });

  it('drops failed batches, logs the outage once, and caps the buffer while the app is down', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const post = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const batcher = new ReadingBatcher(post);

    for (let t = 0; t < MAX_BUFFER + 50; t++) batcher.add(reading(t)); // first POST still in flight
    expect(batcher.pending).toBe(MAX_BUFFER);

    await vi.waitFor(() => expect(batcher.pending).toBeLessThan(MAX_BATCH));
    expect(log.mock.calls.filter(([m]) => String(m).includes('failed'))).toHaveLength(1);
    log.mockRestore();
  });
});

describe('parseCommandBody', () => {
  it.each(['LOCK', 'UNLOCK', 'BUZZ:chime', 'SEG:RK-E', ' LOCK\n'])('accepts raw %j', (body) => {
    expect(parseCommandBody(body)).toEqual({ ok: true, cmd: body.trim() });
  });

  it('accepts JSON {cmd}', () => {
    expect(parseCommandBody('{"cmd":"SEG:LVUP"}')).toEqual({ ok: true, cmd: 'SEG:LVUP' });
  });

  it.each(['LCD:hi|there', 'SEG:TOOLONG', '{"cmd":"BUZZ:honk"}', '{oops', 'lock'])('rejects %j', (body) => {
    expect(parseCommandBody(body).ok).toBe(false);
  });
});

describe('command server', () => {
  let close: () => void = () => {};
  afterEach(() => close());

  async function start(target: CommandTarget): Promise<string> {
    const server = createCommandServer(target);
    server.listen(0);
    await once(server, 'listening');
    close = () => server.close();
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  const target = (open: boolean): CommandTarget & { sent: DeviceCommand[] } => {
    const sent: DeviceCommand[] = [];
    return { sent, isOpen: () => open, write: async (cmd) => void sent.push(cmd) };
  };

  it('writes a valid command to the port', async () => {
    const t = target(true);
    const url = await start(t);

    const res = await fetch(`${url}/cmd`, { method: 'POST', body: '{"cmd":"BUZZ:chime"}' });

    expect(res.status).toBe(200);
    expect(t.sent).toEqual(['BUZZ:chime']);
  });

  it('rejects invalid commands with 400 and writes nothing', async () => {
    const t = target(true);
    const url = await start(t);

    const res = await fetch(`${url}/cmd`, { method: 'POST', body: 'COLOR:red' });

    expect(res.status).toBe(400);
    expect(t.sent).toEqual([]);
  });

  it('returns 503 when the port is closed', async () => {
    const url = await start(target(false));

    const res = await fetch(`${url}/cmd`, { method: 'POST', body: 'LOCK' });

    expect(res.status).toBe(503);
  });

  it('reports serial state on /health and 404s elsewhere', async () => {
    const url = await start(target(false));

    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ data: { serial: 'closed' } });
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});

describe('connectSerial (mock port)', () => {
  it('reads lines from the port and writes commands with a newline', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    SerialPortMock.binding.reset();
    SerialPortMock.binding.createPort('/dev/mock-homebase', { echo: false, record: true });
    const lines: string[] = [];
    const link = connectSerial('mock', (line) => lines.push(line)); // fake Home Base streams pad JSON
    await vi.waitFor(() => expect(link.isOpen()).toBe(true), { timeout: 3_000 });

    await link.write('LOCK');
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(1), { timeout: 3_000 });

    expect(lines[0]).toMatch(/^\{"t":0,/);
    await vi.waitFor(
      () => expect(log.mock.calls.flat().join('\n')).toContain('[fake home base] received LOCK'),
      { timeout: 3_000 },
    );
    expect(NUDGE_MS).toBeLessThan(100); // the follow-up '\n' nudge must stay fast
    link.close();
    log.mockRestore();
  });
});

describe('Home Base firmware lines', () => {
  it('null (absent hardware) is treated as a missing field; extra fields are stripped', () => {
    const reading = parseLine('{"t":2800,"pad":0,"btn":1,"light":749,"snd":673,"ax":0.98,"ay":-0.42,"az":-0.23,"jail":null,"servo":null}');
    expect(reading).toEqual({ t: 2800, source: 'homebase', pad: 0, btn: 1, light: 749, snd: 673, ax: 0.98, ay: -0.42, az: -0.23 });
    expect(parseLine('{"t":5,"ax":null,"ay":null,"az":null,"jail":1}')).toEqual({ t: 5, source: 'homebase', jail: 1 });
  });

  it('recognises boot banners and rejected commands', () => {
    expect(isBootLine('{"boot":"homebase","fw":"oath-1","accel":true,"display":true}')).toBe(true);
    expect(parseLine('{"boot":"homebase"}')).toBeNull();
    expect(failedAck('{"ack":"LOCK","ok":false}')).toBe('LOCK');
    expect(failedAck('{"ack":"SEG:OATH","ok":true}')).toBeNull();
  });

  it('optional servo/IR are enabled only by env', () => {
    expect(configCommands({})).toEqual(['CFG:IR:0', 'CFG:SERVO:0']);
    expect(configCommands({ HOMEBASE_IR: '1', HOMEBASE_SERVO: 'true' })).toEqual(['CFG:IR:1', 'CFG:SERVO:1']);
  });
});
