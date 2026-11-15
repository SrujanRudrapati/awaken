import { beforeEach, describe, expect, it } from 'vitest';
import { getPushupCalibration, resetRouter } from '../../../engine/router';
import { POST } from './route';

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/calibrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe('POST /api/calibrate', () => {
  beforeEach(() => resetRouter());

  it('stores a valid calibration', async () => {
    const res = await POST(post({ upDist: 55, downDist: 14 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { upDist: 55, downDist: 14 },
      error: null,
    });
    expect(getPushupCalibration()).toEqual({ upDist: 55, downDist: 14 });
  });

  it('rejects a range that is too small with 400', async () => {
    const res = await POST(post({ upDist: 20, downDist: 15 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/upDist/);
    expect(getPushupCalibration()).toBeNull();
  });

  it.each([
    [{ upDist: '40', downDist: 10 }],
    [{ upDist: 40 }],
    [{ upDist: 900, downDist: 10 }],
    [{ upDist: 40, downDist: -1 }],
  ])('rejects %j with 400', async (body) => {
    expect((await POST(post(body))).status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    expect((await POST(post('{nope', true))).status).toBe(400);
  });
});
