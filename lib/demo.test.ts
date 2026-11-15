import { describe, expect, it } from 'vitest';
import { isDemoPlayerId } from './demo';

describe('isDemoPlayerId', () => {
  it.each(['demo-1', 'DEMO_jin', 'test-abc', 'Test_x'])('%s is a demo/test player', (id) => {
    expect(isDemoPlayerId(id)).toBe(true);
  });

  it.each(['jin', 'demonstrator', 'testing', 'my-demo-1', 'pdemo-1', '6f1c…-uuid', 'latest-1'])('%s is real', (id) => {
    expect(isDemoPlayerId(id)).toBe(false);
  });
});
