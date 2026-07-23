import { describe, expect, it } from 'vitest';
import { calculateSixPointDistanceInWorker } from '../../src/domain/igc/sixPointDistanceWorkerAdapter.js';

describe('calculateSixPointDistanceInWorker', () => {
  it('calculates through the dedicated worker thread', async () => {
    const result = await calculateSixPointDistanceInWorker([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 11 },
      { latitude: 0, longitude: 2 },
      { latitude: 0, longitude: 12 },
    ]);

    expect(result.pointIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it('rejects invalid input from the worker', async () => {
    await expect(calculateSixPointDistanceInWorker([])).rejects
      .toThrow('requires at least 6 points');
  });
});
