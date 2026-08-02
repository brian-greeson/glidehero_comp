import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { initializePlanPage, requestPlanExport } from '../../public/scripts/app-ui/plan.js';

const result = {
  exportToken: '00000000-0000-4000-8000-000000000099',
  anchors: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
  route: [{ latitude: 39, longitude: -105 }, { latitude: 39.5, longitude: -104.6 }, { latitude: 40, longitude: -104 }],
};

describe('Plan export controller', () => {
  it('requests a server-authorized export without resubmitting route coordinates', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response('task', {
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="glidehero-main-turnpoints.cup"' },
    }));

    const exported = await requestPlanExport({
      fetchImpl, result, variant: 'main-turnpoints', format: 'cup', prefix: 'GH',
    });

    expect(exported.filename).toBe('glidehero-main-turnpoints.cup');
    expect(await exported.blob.text()).toBe('task');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({
      variant: 'main-turnpoints', format: 'cup', prefix: 'GH', exportToken: result.exportToken,
    });
  });

  it('rejects export attempts without a server authorization', async () => {
    await expect(requestPlanExport({
      fetchImpl: vi.fn(), result: { anchors: result.anchors, route: result.route },
      variant: 'main-turnpoints', format: 'cup', prefix: 'GH',
    })).rejects.toThrow('Calculate a route');
  });

  it('invalidates the authorized export as soon as a turnpoint is dragged', async () => {
    const handlers = new Map<string, (event?: unknown) => void>();
    const source = { setData: vi.fn() };
    const map = {
      addControl: vi.fn(), getSource: vi.fn(() => source), getLayer: vi.fn(), setLayoutProperty: vi.fn(),
      getCanvas: vi.fn(() => ({ style: {} })), dragPan: { disable: vi.fn(), enable: vi.fn() },
      on: vi.fn((event: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) => {
        handlers.set(handler ? `${event}:${layerOrHandler}` : event, handler ?? layerOrHandler as (event?: unknown) => void);
      }),
    };
    const controls = new Map<string, { disabled: boolean; textContent: string; addEventListener: ReturnType<typeof vi.fn> }>();
    const control = (selector: string) => {
      const value = { disabled: true, textContent: '', addEventListener: vi.fn() };
      controls.set(selector, value);
      return value;
    };
    const nodes = new Map<string, unknown>([
      ['[data-plan-page]', {}],
      ['[data-plan-map]', { dataset: { mapStyleUrl: 'style', thermalTileUrl: 'tiles' } }],
      ...[
        '[data-plan-status]', '[data-plan-undo]', '[data-plan-delete]', '[data-plan-reset]',
        '[data-plan-direct-distance]', '[data-plan-route-distance]', '[data-plan-extra-distance]',
        '[data-plan-maximum-distance]', '[data-plan-direct-cells]', '[data-plan-enclosed-cells]',
        '[data-plan-new-cells]', '[data-plan-export-open]',
      ].map((selector) => [selector, control(selector)] as const),
    ]);
    const documentRef = {
      querySelector: (selector: string) => nodes.get(selector) ?? null,
      querySelectorAll: () => [],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
      actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
      claims: { direct: [], enclosed: [], newPersonal: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const controller = initializePlanPage({
      documentRef, fetchImpl,
      maplibre: { Map: class { constructor() { return map; } }, NavigationControl: class {} },
    });
    controller.anchors.push(...result.anchors);
    await controller.calculate();
    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(false);

    handlers.get('mousedown:plan-anchors')?.({ features: [{ properties: { index: 0 } }] });
    handlers.get('mousemove')?.({ lngLat: { lat: 39.2, lng: -105.2 } });

    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(true);
    expect(controls.get('[data-plan-route-distance]')?.textContent).toBe('—');
  });
});
