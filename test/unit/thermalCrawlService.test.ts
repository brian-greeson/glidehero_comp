import { describe, expect, it, vi } from 'vitest';
import { createThermalCrawlService } from '../../src/services/thermalCrawlService.js';

const target: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [-105.1, 39], [-105, 39], [-105, 39.1], [-105.1, 39.1], [-105.1, 39],
  ]],
};

describe('thermal crawl service', () => {
  it('creates a bounded job only when it produces crawl tiles', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const database = {
      transaction: vi.fn(async (work: (transaction: { execute: typeof execute }) => Promise<string>) => work({ execute })),
    };
    const service = createThermalCrawlService(database as never);

    await expect(service.create({ name: ' Front Range ', geometry: target, userId: 'user-1' })).resolves.toBe('job-1');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rolls back a target that intersects no supported tile', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const database = {
      transaction: vi.fn(async (work: (transaction: { execute: typeof execute }) => Promise<string>) => work({ execute })),
    };
    const service = createThermalCrawlService(database as never);

    await expect(service.create({ name: 'Empty', geometry: target, userId: 'user-1' }))
      .rejects.toThrow('does not intersect any supported tiles');
  });

  it('rejects malformed or out-of-bounds polygons before opening a transaction', async () => {
    const database = { transaction: vi.fn() };
    const service = createThermalCrawlService(database as never);
    const openRing = { type: 'Polygon', coordinates: [[[-105, 39], [-104, 39], [-104, 40], [-105, 40]]] } as GeoJSON.Polygon;
    const outOfBounds = { type: 'Polygon', coordinates: [[[181, 39], [181, 40], [179, 40], [181, 39]]] } as GeoJSON.Polygon;

    await expect(service.create({ name: 'Open', geometry: openRing, userId: 'user-1' })).rejects.toThrow('must be closed');
    await expect(service.create({ name: 'Outside', geometry: outOfBounds, userId: 'user-1' })).rejects.toThrow('outside the supported map bounds');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('does not reset failed tiles when a cancelled job rejects a resume', async () => {
    const database = { execute: vi.fn(async () => ({ rows: [] })) };
    const service = createThermalCrawlService(database as never);

    await expect(service.setStatus('job-1', 'running')).resolves.toBe(false);
    expect(database.execute).toHaveBeenCalledOnce();
  });
});
