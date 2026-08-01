import { describe, expect, it, vi } from 'vitest';
import { createPlanService } from '../../src/services/planService.js';

describe('plan service input bounds', () => {
  const database = { execute: vi.fn() };
  const service = createPlanService(database as never, { cellSize: 500 });

  it('rejects duplicate consecutive anchors before querying PostGIS', async () => {
    await expect(service.route({
      userId: 'user-1', maximumDeviationPercent: 20,
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -105 }],
    })).rejects.toThrow('must be distinct');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('rejects pathological leg lengths before generating a grid preview', async () => {
    await expect(service.route({
      userId: 'user-1', maximumDeviationPercent: 20,
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -80 }],
    })).rejects.toThrow('1,000 km or shorter');
    expect(database.execute).not.toHaveBeenCalled();
  });
});
