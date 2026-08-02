import { describe, expect, it, vi } from 'vitest';
import { createPlanExportService, PLAN_EXPORT_RATE_LIMIT } from '../../src/services/planExportService.js';

describe('Plan export service', () => {
  it('enriches points once and names each content variant', async () => {
    const elevations = { elevations: vi.fn(async () => [1_500, 1_600]) };
    let authorization = '';
    const valkey = {
      set: vi.fn(async (_key: string, value: string) => { authorization = value; return 'OK'; }),
      get: vi.fn(async () => authorization),
      invokeScript: vi.fn(async () => 1),
    };
    const service = createPlanExportService(elevations, valkey as never);
    const points = [{ latitude: 39, longitude: -105 }, { latitude: 39.1, longitude: -104.9 }];
    const exportToken = await service.authorize({ userId: 'user-1', anchors: points, route: points });

    const main = await service.export({ userId: 'user-1', exportToken, format: 'cup', variant: 'main-turnpoints', prefix: 'gh' });
    const optimized = await service.export({ userId: 'user-1', exportToken, format: 'xctsk', variant: 'optimized-track', prefix: 'gh' });

    expect(main.filename).toBe('glidehero-main-turnpoints.cup');
    expect(optimized.filename).toBe('glidehero-optimized-track.xctsk');
    expect(main.body).toContain('1500m');
    expect(elevations.elevations).toHaveBeenCalledOnce();
  });

  it('rejects tokens owned by another user before consuming elevation quota', async () => {
    const authorization = JSON.stringify({
      userId: 'user-1', anchors: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
      route: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
    });
    const valkey = { get: vi.fn(async () => authorization), set: vi.fn(), invokeScript: vi.fn() };
    const elevations = { elevations: vi.fn() };
    const service = createPlanExportService(elevations as never, valkey as never);

    await expect(service.export({
      userId: 'user-2', exportToken: 'token', format: 'cup', variant: 'main-turnpoints', prefix: 'GH',
    })).rejects.toThrow('expired');
    expect(valkey.invokeScript).not.toHaveBeenCalled();
    expect(elevations.elevations).not.toHaveBeenCalled();
  });

  it('enforces the per-user export quota before requesting elevations', async () => {
    const authorization = JSON.stringify({
      userId: 'user-1', anchors: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
      route: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
    });
    const valkey = {
      get: vi.fn(async () => authorization), set: vi.fn(),
      invokeScript: vi.fn(async () => PLAN_EXPORT_RATE_LIMIT + 1),
    };
    const elevations = { elevations: vi.fn() };
    const service = createPlanExportService(elevations as never, valkey as never);

    await expect(service.export({
      userId: 'user-1', exportToken: 'token', format: 'cup', variant: 'main-turnpoints', prefix: 'GH',
    })).rejects.toMatchObject({ status: 429 });
    expect(elevations.elevations).not.toHaveBeenCalled();
  });
});
