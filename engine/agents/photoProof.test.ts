import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));
vi.mock('../../lib/device', () => ({ send: vi.fn().mockResolvedValue(true), sendAll: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/llm', () => ({ geminiJson: vi.fn() }));
vi.mock('../../lib/aws/s3', () => ({
  PHOTO_MIME_TYPES: ['image/jpeg', 'image/png'],
  storeProof: vi.fn(async () => ({ storage: 'local', key: 'proofs/p1/q/1.jpg' })),
  proofUrl: vi.fn(async () => null),
}));

import { subscribe } from '../../lib/bus';
import * as db from '../../lib/db';
import { geminiJson } from '../../lib/llm';
import { createPlayer, getQuest, resetEngine, startQuest } from '../quests';
import { resetRouter } from '../router';
import { decide, submitPhotoProof } from './photoProof';

const jpeg = (playerId: string, questId: string) => ({ playerId, questId, bytes: new Uint8Array([0xff, 0xd8]), mimeType: 'image/jpeg' });

describe('photo proof', () => {
  let questId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRouter();
    resetEngine();
    await createPlayer({ name: 'Jin', id: 'p1' });
    questId = (await startQuest('p1', { type: 'photo', title: 'Clean your desk' })).id;
  });

  it('confidence below 0.7 never passes, even if the model says passed', () => {
    expect(decide({ passed: true, confidence: 0.69, reason: 'Blurry desk' })).toMatchObject({ passed: false, reason: 'Needs better proof: Blurry desk' });
    expect(decide({ passed: true, confidence: 0.7, reason: 'Clean desk' }).passed).toBe(true);
    expect(decide(null)).toMatchObject({ passed: false, confidence: 0 });
  });

  it('a confident pass completes the quest and logs the verdict with its reason', async () => {
    vi.mocked(geminiJson).mockResolvedValue({ passed: true, confidence: 0.92, reason: 'Desk is clear and tidy.' });

    const result = await submitPhotoProof(jpeg('p1', questId));

    expect(result.passed).toBe(true);
    expect(getQuest(questId)?.status).toBe('done');
    expect(vi.mocked(geminiJson).mock.calls[0][0].prompt).toContain('Clean your desk');
    expect(db.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'photo.verdict',
        source: 'photo',
        verified: true,
        value: 0.92,
        detail: expect.objectContaining({ reason: 'Desk is clear and tidy.', storage: 'local' }),
      }),
    );
  });

  it('Field Vows (gate) check in by photo: a confident photo at the event keeps the vow', async () => {
    const gate = await startQuest('p1', { type: 'gate', title: 'Campus 5K at the Quad' });
    vi.mocked(geminiJson).mockResolvedValue({ passed: true, confidence: 0.88, reason: 'Race bib and start banner visible.' });

    const result = await submitPhotoProof(jpeg('p1', gate.id));

    expect(result.passed).toBe(true);
    expect(getQuest(gate.id)?.status).toBe('done');
    expect(vi.mocked(geminiJson).mock.calls[0][0].prompt).toMatch(/Field Vow.*Campus 5K at the Quad/);
  });

  it('a Field Vow photo under 0.7 confidence does not check in', async () => {
    const gate = await startQuest('p1', { type: 'gate', title: 'Campus 5K at the Quad' });
    vi.mocked(geminiJson).mockResolvedValue({ passed: true, confidence: 0.5, reason: 'Could be any park.' });

    expect((await submitPhotoProof(jpeg('p1', gate.id))).passed).toBe(false);
    expect(getQuest(gate.id)?.status).toBe('active');
  });

  it('a failed photo keeps the quest active (retry allowed) and publishes the reason', async () => {
    vi.mocked(geminiJson).mockResolvedValue({ passed: false, confidence: 0.95, reason: 'This is a screenshot.' });
    const events: unknown[] = [];
    const unsubscribe = subscribe((e) => events.push(e));

    const result = await submitPhotoProof(jpeg('p1', questId));
    unsubscribe();

    expect(result.passed).toBe(false);
    expect(getQuest(questId)?.status).toBe('active');
    expect(events).toContainEqual({ type: 'rep.rejected', playerId: 'p1', questId, reason: 'This is a screenshot.' });
  });

  it('rejects bad input before calling Gemini', async () => {
    const sensorQuest = (await startQuest('p1', { type: 'squat' })).id;
    await expect(submitPhotoProof(jpeg('p1', sensorQuest))).rejects.toThrow(/not a photo vow/);
    await expect(submitPhotoProof(jpeg('someone-else', questId))).rejects.toThrow(/No vow/);
    await expect(submitPhotoProof({ ...jpeg('p1', questId), mimeType: 'image/gif' })).rejects.toThrow(/Unsupported/);
    await expect(submitPhotoProof({ ...jpeg('p1', questId), bytes: new Uint8Array() })).rejects.toThrow(/Empty/);
    expect(geminiJson).not.toHaveBeenCalled();
  });
});
