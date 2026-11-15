import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireCronSecret, requireSyncToken } from './auth';

const req = (headers: Record<string, string> = {}): Request => new Request('http://x', { method: 'POST', headers });

describe('route auth', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.SYNC_TOKEN;
  });

  it('cron: refuses everyone when CRON_SECRET is unset (fail closed)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(requireCronSecret(req())?.status).toBe(401);
    expect(requireCronSecret(req({ authorization: 'Bearer ' }))?.status).toBe(401);
  });

  it('cron: needs the exact bearer secret', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(requireCronSecret(req())?.status).toBe(401);
    expect(requireCronSecret(req({ authorization: 'Bearer wrong!' }))?.status).toBe(401);
    expect(requireCronSecret(req({ authorization: 's3cret' }))?.status).toBe(401);
    expect(requireCronSecret(req({ authorization: 'Bearer s3cret' }))).toBeNull();
  });

  it('sync: refuses everyone when SYNC_TOKEN is unset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(requireSyncToken(req({ 'x-sync-token': '' }))?.status).toBe(401);
  });

  it('sync: accepts X-Sync-Token or Bearer, rejects anything else', () => {
    process.env.SYNC_TOKEN = 'tok';
    expect(requireSyncToken(req())?.status).toBe(401);
    expect(requireSyncToken(req({ 'x-sync-token': 'nope' }))?.status).toBe(401);
    expect(requireSyncToken(req({ 'x-sync-token': 'tok' }))).toBeNull();
    expect(requireSyncToken(req({ authorization: 'Bearer tok' }))).toBeNull();
  });
});

describe('isLocalRequest', () => {
  it('trusts only loopback Host with no tunnel/proxy client headers', async () => {
    const { isLocalRequest } = await import('./auth');
    const at = (url: string, headers: Record<string, string> = {}) => new Request(url, { method: 'POST', headers });

    expect(isLocalRequest(at('http://localhost:3000/api/readings'))).toBe(true);
    expect(isLocalRequest(at('http://127.0.0.1:3000/api/readings', { 'x-forwarded-for': '::1' }))).toBe(true);
    expect(isLocalRequest(at('https://abc.trycloudflare.com/api/readings', { 'cf-connecting-ip': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(at('http://localhost:3000/api/readings', { 'cf-connecting-ip': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(at('http://localhost:3000/api/readings', { 'x-forwarded-for': '192.168.1.20' }))).toBe(false);
    expect(isLocalRequest(at('http://192.168.1.5:3000/api/readings'))).toBe(false);
  });
});
