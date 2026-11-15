import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
  insertSleepSamples: vi.fn().mockResolvedValue(null),
  listSleepSamples: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../lib/llm', () => ({ claude: vi.fn().mockResolvedValue('[sighs] Seven hours. [whispers] …Acceptable.') }));
vi.mock('../lib/memory', () => ({ recall: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/voice/tts', () => ({ speak: vi.fn().mockResolvedValue(null) }));

import { subscribe } from '../lib/bus';
import { recordLight, resetLightHistory } from '../lib/homebaseLight';
import type { SleepSample, SleepStage, StreamEvent } from '../lib/schemas';
import { resetSleepStore } from '../lib/sleepStore';
import { createPlayer, getQuest, resetEngine, startQuest } from './quests';
import { resetRouter } from './router';
import { LIGHT_CONFIRM_BONUS, resetSleepSync, syncSleep } from './sleepSync';

/** Vows created on Jan 1 2030 (deadline Jan 2 noon) are about the night of Jan 1. */
const CREATED = new Date(2030, 0, 1, 15, 0);
const MORNING = new Date(2030, 0, 2, 8, 0);
const at = (day: number, hh: number, mm: number) => new Date(2030, 0, day, hh, mm);
const sample = (stage: SleepStage, start: Date, minutes: number): SleepSample => ({ stage, start, end: new Date(start.getTime() + minutes * 60_000) });

/** Asleep 23:40 → 07:20 (7 h 40 min, 70 min deep). */
const goodNight = (): SleepSample[] => [
  sample('Core', at(1, 23, 40), 60), sample('Deep', at(2, 0, 40), 70), sample('Awake', at(2, 1, 50), 5),
  sample('REM', at(2, 1, 55), 45), sample('Core', at(2, 2, 40), 280),
];

describe('sleep sync → vows → morning summary', () => {
  let events: StreamEvent[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CREATED);
    resetRouter();
    resetEngine();
    resetSleepStore();
    resetSleepSync();
    resetLightHistory();
    events = [];
    subscribe((e) => events.push(e));
    await createPlayer({ name: 'Jin', id: 'p1' });
  });

  it('keeps lights-out (with room confirmation bonus), bedtime and 7 h sleep; announces once', async () => {
    const lights = await startQuest('p1', { type: 'lightsoutby', targetTime: '23:45' });
    const bedtime = await startQuest('p1', { type: 'bedtime', targetTime: '23:30' });
    const sleep = await startQuest('p1', { type: 'sleep' }); // 7 h target
    recordLight({ t: 0, source: 'homebase', light: 12 }, at(1, 23, 35).getTime()); // room went dark 23:35
    vi.setSystemTime(MORNING);

    const result = await syncSleep('p1', goodNight(), MORNING);

    expect(result.lastNight).toMatchObject({ night: '2030-01-01', asleepMinutes: 455, deepMinutes: 70, awakenings: 1 });
    expect(getQuest(lights.id)?.status).toBe('done');
    expect(getQuest(lights.id)?.xp).toBe(lights.xp + LIGHT_CONFIRM_BONUS);
    expect(getQuest(bedtime.id)?.status).toBe('done');
    expect(getQuest(sleep.id)?.status).toBe('done');
    const summary = events.find((e) => e.type === 'sleep.summary');
    expect(summary).toMatchObject({ playerId: 'p1', irisMood: 'sleepy', line: 'Seven hours. …Acceptable.' });
    expect(events.find((e) => e.type === 'voice')).toMatchObject({ eventType: 'sleep', irisMood: 'sleepy' });

    const again = await syncSleep('p1', goodNight(), MORNING); // the Shortcut resends the same day
    expect(again.added).toBe(0);
    expect(again.announced).toBe(false);
    expect(events.filter((e) => e.type === 'sleep.summary')).toHaveLength(1);
  });

  it('a late night breaks lights-out (the Reckoning) and short sleep only records progress', async () => {
    const lights = await startQuest('p1', { type: 'lightsoutby', targetTime: '23:00' });
    const sleep = await startQuest('p1', { type: 'sleep' });
    vi.setSystemTime(MORNING);

    const result = await syncSleep('p1', [sample('Core', at(2, 1, 10), 240)], MORNING); // 01:10 → 05:10

    expect(getQuest(lights.id)?.status).toBe('failed');
    expect(result.verdicts.find((v) => v.type === 'lightsoutby')?.detail).toBe('Asleep at 01:10, after your 23:00 vow.');
    expect(events.some((e) => e.type === 'penalty')).toBe(true);
    expect(getQuest(sleep.id)).toMatchObject({ status: 'active', progress: 4 });
  });

  it('unknown person → 404; no asleep samples → no summary', async () => {
    await expect(syncSleep('nobody', goodNight(), MORNING)).rejects.toThrow(/No one found/);
    const result = await syncSleep('p1', [sample('InBed', at(1, 23, 0), 60)], MORNING);
    expect(result.lastNight).toBeNull();
    expect(events.some((e) => e.type === 'sleep.summary')).toBe(false);
  });
});
