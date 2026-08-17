import { describe, expect, it, vi } from 'vitest';
import { createPlanService } from '../../src/services/planService.js';

describe('plan service input bounds', () => {
  const database = { execute: vi.fn() };
  const service = createPlanService(database as never);

  it('rejects duplicate consecutive anchors before querying PostGIS', async () => {
    await expect(service.route({
      routingPriority: 'balanced',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -105 }],
    })).rejects.toThrow('must be distinct');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('rejects pathological leg lengths before querying thermal data', async () => {
    await expect(service.route({
      routingPriority: 'balanced',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39, longitude: -80 }],
    })).rejects.toThrow('1,000 km or shorter');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('keeps every user anchor fixed while optimizing each leg independently', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const plans = createPlanService({ execute } as never);
    const anchors = [
      { latitude: 39, longitude: -105 },
      { latitude: 39.02, longitude: -104.98 },
      { latitude: 39.01, longitude: -104.94 },
    ];

    const result = await plans.route({ routingPriority: 'shorter', anchors });

    expect(result.anchors).toEqual(anchors);
    expect(result.route).toEqual(anchors);
    expect(result.legs).toHaveLength(2);
    expect(result.legs.every((leg) => leg.routeDistanceMeters === leg.directDistanceMeters)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('falls back to the direct leg when the scored field has no thermal activity', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const plans = createPlanService({ execute } as never);
    const anchors = [
      { latitude: 39, longitude: -105 },
      { latitude: 39.01, longitude: -104.95 },
    ];

    const result = await plans.route({ routingPriority: 'thermal', anchors });

    expect(result.route).toEqual(anchors);
    expect(result.thermalCoverage).toBe('unavailable');
    expect(result.actualDeviationPercent).toBe(0);
    expect(result.actualExtraDistanceMeters).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns routing data without querying or returning cell previews', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const plans = createPlanService({ execute } as never);

    const result = await plans.route({
      routingPriority: 'shorter',
      anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39.01, longitude: -104.99 }],
    });

    expect(result).not.toHaveProperty('claims');
    expect(execute).toHaveBeenCalledOnce();
  });
});
