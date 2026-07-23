import { describe, expect, it } from 'vitest';
import { calculateNPointDistancesInWorker } from '../../src/domain/igc/nPointDistanceWorkerAdapter.js';

describe('calculateNPointDistancesInWorker', () => {
  it('calculates every route through one dedicated worker thread', async () => {
    const result = await calculateNPointDistancesInWorker([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 11 },
      { latitude: 0, longitude: 2 },
      { latitude: 0, longitude: 12 },
    ]);

    expect(result.threePointDistance.pointIndices).toHaveLength(3);
    expect(result.fourPointDistance.pointIndices).toHaveLength(4);
    expect(result.fivePointDistance.pointIndices).toHaveLength(5);
    expect(result.sixPointDistance.pointIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.threePointDistance.distanceMeters).toBeGreaterThan(0);
    expect(result.fourPointDistance.distanceMeters).toBeGreaterThan(0);
    expect(result.fivePointDistance.distanceMeters).toBeGreaterThan(0);
    expect(result.sixPointDistance.distanceMeters).toBeGreaterThan(0);
  });

  it('rejects invalid input from the worker', async () => {
    await expect(calculateNPointDistancesInWorker([])).rejects
      .toThrow('requires at least 6 points');
  });
});
