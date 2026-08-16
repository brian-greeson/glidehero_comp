import { describe, expect, it } from 'vitest';
import { scoringProtectedSequenceNumbers } from '../../src/services/flightMapProjectionService.js';

describe('scoringProtectedSequenceNumbers', () => {
  it('unions scoring turnpoints without duplicates', () => {
    expect([...scoringProtectedSequenceNumbers({
      threePointDistance: { points: [{ sequenceNumber: 0 }, { sequenceNumber: 3 }, { sequenceNumber: 9 }] },
      fivePointDistance: { points: [{ sequenceNumber: 0 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }] },
    })].sort((left, right) => left - right)).toEqual([0, 2, 3, 9]);
  });
});
