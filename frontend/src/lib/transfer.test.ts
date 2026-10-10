import { describe, expect, it } from 'vitest';
import { planParts, PART_BYTES } from './transfer';

describe('planParts', () => {
  it('tiles exactly with a clipped tail', () => {
    const total = 2 * PART_BYTES + 123;
    const parts = planParts(total);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ start: 0, end: PART_BYTES - 1 });
    expect(parts[2]).toEqual({ start: 2 * PART_BYTES, end: total - 1 });
    const covered = parts.reduce((a, p) => a + (p.end - p.start + 1), 0);
    expect(covered).toBe(total);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].start).toBe(parts[i - 1].end + 1);
    }
  });

  it('handles exact multiples and tiny files', () => {
    expect(planParts(PART_BYTES)).toEqual([{ start: 0, end: PART_BYTES - 1 }]);
    expect(planParts(1)).toEqual([{ start: 0, end: 0 }]);
  });
});
