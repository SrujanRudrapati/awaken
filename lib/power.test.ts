import { describe, expect, it } from 'vitest';
import { power, proofScale, rankForPower, seedProofForRank, spreadProof, spreadProofToNextRank, zeroProof } from './power';

describe('Power → rank', () => {
  it('√ per stat plus a balance bonus from the weakest stat', () => {
    expect(power({ ...zeroProof(), STR: 100 })).toBe(10); // no balance bonus: other stats are 0
    expect(power({ STR: 25, INT: 25, FOCUS: 25, VIT: 25, DISCIPLINE: 25, CHA: 25 })).toBe(45); // 6×5 + 3×5
  });

  it('balanced training outranks piling into one stat', () => {
    const lopsided = { ...zeroProof(), STR: 600 };
    const balanced = { STR: 100, INT: 100, FOCUS: 100, VIT: 100, DISCIPLINE: 100, CHA: 100 };
    expect(rankForPower(power(lopsided))).toBe('E');
    expect(rankForPower(power(balanced))).toBe('C'); // 6×10 + 30 = 90
  });

  it('rank bands E/D/C/B/A with A on top', () => {
    expect([0, 29.9, 30, 70, 140, 250, 9999].map(rankForPower)).toEqual(['E', 'E', 'D', 'C', 'B', 'A', 'A']);
  });

  it('Calibration seeds land in their rank band; DEMO_MODE spread reaches the next rank', () => {
    expect(rankForPower(power(seedProofForRank('D')))).toBe('D');
    expect(rankForPower(power(seedProofForRank('C')))).toBe('C');
    const need = spreadProofToNextRank(zeroProof());
    expect(rankForPower(power(spreadProof(zeroProof(), need)))).toBe('D');
    expect(rankForPower(power(spreadProof(zeroProof(), need - 4)))).toBe('E');
  });

  it('Proof scales to the personal baseline, within 0.5×–2×', () => {
    const pushup = { type: 'pushup' as const, stat: 'STR' as const };
    expect(proofScale(pushup, null)).toBe(1);
    expect(proofScale(pushup, { bodyReps: 25 })).toBe(1);
    expect(proofScale(pushup, { bodyReps: 6 })).toBe(2); // a beginner's push-ups weigh more
    expect(proofScale(pushup, { bodyReps: 100 })).toBe(0.5);
    expect(proofScale({ type: 'meditate', stat: 'FOCUS' }, { bodyReps: 6 })).toBe(1);
  });
});
