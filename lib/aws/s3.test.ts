import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc'),
}));

import { proofKey, proofUrl, resetS3, storeProof } from './s3';

const upload = { playerId: 'p1', questId: 'q1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
const AWS_ENV = { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret', S3_PROOF_BUCKET: 'awaken-proofs' };

describe('proof storage', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetS3();
    dir = await mkdtemp(path.join(os.tmpdir(), 'awaken-proof-test-'));
    process.env.PROOF_LOCAL_DIR = dir;
  });
  afterEach(async () => {
    for (const key of [...Object.keys(AWS_ENV), 'PROOF_LOCAL_DIR']) delete process.env[key];
    await rm(dir, { recursive: true, force: true });
  });

  it('keys cannot escape their folder (ids are user input)', () => {
    expect(proofKey({ playerId: '../../etc', questId: 'q/1', mimeType: 'image/png' }, 5)).toBe('proofs/______etc/q_1/5.png');
  });

  it('without AWS env, stores locally and gives no URL', async () => {
    const stored = await storeProof(upload);

    expect(stored.storage).toBe('local');
    expect(send).not.toHaveBeenCalled();
    expect([...(await readFile(path.join(dir, stored.key)))]).toEqual([1, 2, 3]);
    expect(await proofUrl(stored)).toBeNull();
  });

  it('with AWS env, uploads privately with SSE and presigns a GET', async () => {
    Object.assign(process.env, AWS_ENV);
    send.mockResolvedValue({});

    const stored = await storeProof(upload);

    expect(stored.storage).toBe('s3');
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({ Bucket: 'awaken-proofs', ContentType: 'image/jpeg', ServerSideEncryption: 'AES256' });
    expect(input).not.toHaveProperty('ACL');
    expect(await proofUrl(stored)).toMatch(/X-Amz-Signature/);
  });

  it('falls back to local storage when S3 errors', async () => {
    Object.assign(process.env, AWS_ENV);
    send.mockRejectedValue(new Error('AccessDenied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await storeProof(upload)).storage).toBe('local');
  });
});
