import { describe, expect, it, vi } from 'vitest';
import { createPlanService } from '../../src/services/planService.js';

describe('plan service input bounds', () => {
  const database = { execute: vi.fn() };
  const service = createPlanService(database as never, { cellSize: 500 });

  it('rejects duplicate consecutive anchors before querying PostGIS', async () => {
    await expect(service.route({
      userId: 'user-1', routingPriority: 'balanced',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -105 }],
    })).rejects.toThrow('must be distinct');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('rejects pathological leg lengths before generating a grid preview', async () => {
    await expect(service.route({
      userId: 'user-1', routingPriority: 'balanced',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -80 }],
    })).rejects.toThrow('1,000 km or shorter');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('keeps every user anchor fixed while optimizing each leg independently', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const plans = createPlanService({ execute } as never, { cellSize: 500 });
    const anchors = [
      { latitude: 39, longitude: -105 },
      { latitude: 39.02, longitude: -104.98 },
      { latitude: 39.01, longitude: -104.94 },
    ];

    const result = await plans.route({ userId: 'user-1', routingPriority: 'shorter', anchors });

    expect(result.anchors).toEqual(anchors);
    expect(result.route).toEqual(anchors);
    expect(result.legs).toHaveLength(2);
    expect(result.legs.every((leg) => leg.routeDistanceMeters === leg.directDistanceMeters)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('falls back to the direct leg when the scored field has no thermal activity', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const plans = createPlanService({ execute } as never, { cellSize: 500 });
    const anchors = [
      { latitude: 39, longitude: -105 },
      { latitude: 39.01, longitude: -104.95 },
    ];

    const result = await plans.route({ userId: 'user-1', routingPriority: 'thermal', anchors });

    expect(result.route).toEqual(anchors);
    expect(result.thermalCoverage).toBe('unavailable');
    expect(result.actualDeviationPercent).toBe(0);
    expect(result.actualExtraDistanceMeters).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns route claims without a personal comparison for a guest', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        x: 1,
        y: 2,
        source: 'direct',
        isNewPersonal: false,
        geometry: { type: 'Polygon', coordinates: [] },
      }] });
    const plans = createPlanService({ execute } as never, { cellSize: 500 });

    const result = await plans.route({
      userId: null,
      routingPriority: 'shorter',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39.01, longitude: -104.99 }],
    });

    expect(result.claims.direct).toHaveLength(1);
    expect(result.claims.enclosed).toEqual([]);
    expect(result.claims.newPersonal).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
