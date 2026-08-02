import { describe, expect, it, vi } from 'vitest';
import { createThermalAreaMapService } from '../../src/services/thermalAreaMapService.js';

const geometry = { type: 'MultiPolygon', coordinates: [[[[-105, 39], [-104.9, 39], [-104.9, 39.1], [-105, 39.1], [-105, 39]]]] } as GeoJSON.MultiPolygon;

describe('thermal area map service', () => {
  it('maps stored processed areas into minimal GeoJSON properties', async () => {
    const execute = vi.fn(async () => ({ rows: [{
      activityBand: 'yellow_orange', relativeScore: '0.75',
      processedAt: new Date('2026-08-02T20:32:00Z'), geometry,
    }] }));
    const service = createThermalAreaMapService({ execute } as never);

    await expect(service.getViewport({ west: -106, south: 38, east: -104, north: 40 })).resolves.toEqual({
      status: 'ok',
      geojson: { type: 'FeatureCollection', features: [{
        type: 'Feature',
        properties: { activityBand: 'yellow_orange', relativeScore: 0.75, processedAt: '2026-08-02T20:32:00.000Z' },
        geometry,
      }] },
    });
  });

  it('rejects a viewport response beyond the configured feature limit', async () => {
    const row = { activityBand: 'red', relativeScore: 1, processedAt: new Date(), geometry };
    const execute = vi.fn(async () => ({ rows: [row, row] }));
    const service = createThermalAreaMapService({ execute } as never, { maximumFeatures: 1 });

    await expect(service.getViewport({ west: -106, south: 38, east: -104, north: 40 }))
      .resolves.toEqual({ status: 'too_large' });
  });
});
