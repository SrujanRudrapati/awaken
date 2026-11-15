/**
 * Proof photo storage. S3 when configured (private bucket, SSE, presigned GET URLs only —
 * objects are never public); otherwise, or if S3 errors, a local directory so the demo never
 * breaks. Local files get no URL (they are only kept as evidence).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsRegion, hasAwsCredentials, logAwsFailure } from './config';

export const PRESIGN_EXPIRES_S = 15 * 60;
const S3_TIMEOUT_MS = 10_000;
const DEFAULT_LOCAL_DIR = '/tmp/awaken-proofs';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
export const PHOTO_MIME_TYPES = Object.keys(EXTENSIONS);

export interface StoredProof {
  storage: 's3' | 'local';
  /** S3 key, or path relative to the local proof dir. */
  key: string;
}

export interface ProofUpload {
  playerId: string;
  questId: string;
  bytes: Uint8Array;
  mimeType: string;
}

const globalForS3 = globalThis as typeof globalThis & { __awakenS3?: S3Client };

export function proofBucket(): string | null {
  return process.env.S3_PROOF_BUCKET || null;
}

export function isS3Configured(): boolean {
  return Boolean(proofBucket()) && hasAwsCredentials();
}

function s3(): S3Client {
  globalForS3.__awakenS3 ??= new S3Client({ region: awsRegion() ?? undefined, maxAttempts: 2 });
  return globalForS3.__awakenS3;
}

/** Path-safe segment: ids are user-supplied, so nothing but [A-Za-z0-9_-] reaches a key or path. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_';
}

export function proofKey(upload: Pick<ProofUpload, 'playerId' | 'questId' | 'mimeType'>, now = Date.now()): string {
  const ext = EXTENSIONS[upload.mimeType] ?? 'bin';
  return `proofs/${safeSegment(upload.playerId)}/${safeSegment(upload.questId)}/${now}.${ext}`;
}

export function localProofDir(): string {
  return process.env.PROOF_LOCAL_DIR || DEFAULT_LOCAL_DIR;
}

async function storeLocal(key: string, bytes: Uint8Array): Promise<StoredProof> {
  const file = path.join(localProofDir(), key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { storage: 'local', key };
}

async function storeS3(bucket: string, key: string, upload: ProofUpload): Promise<StoredProof> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: upload.bytes,
      ContentType: upload.mimeType,
      ServerSideEncryption: 'AES256',
    }),
    { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) },
  );
  return { storage: 's3', key };
}

/** Saves the photo to S3, or locally if S3 isn't configured or fails. Throws only if both fail. */
export async function storeProof(upload: ProofUpload): Promise<StoredProof> {
  const key = proofKey(upload);
  const bucket = proofBucket();
  if (bucket && hasAwsCredentials()) {
    try {
      return await storeS3(bucket, key, upload);
    } catch (error) {
      logAwsFailure('s3 put', error);
    }
  }
  return storeLocal(key, upload.bytes);
}

/** Short-lived presigned GET for an S3 proof; null for local proofs or on failure. */
export async function proofUrl(stored: StoredProof): Promise<string | null> {
  const bucket = proofBucket();
  if (stored.storage !== 's3' || !bucket) return null;
  try {
    return await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: stored.key }), {
      expiresIn: PRESIGN_EXPIRES_S,
    });
  } catch (error) {
    logAwsFailure('s3 presign', error);
    return null;
  }
}

/** Test hook. */
export function resetS3(): void {
  globalForS3.__awakenS3 = undefined;
}
