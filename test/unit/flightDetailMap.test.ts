import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { chooseContrastingTrackColor, FLIGHT_DETAIL_SOURCE_IDS, flightTrackBounds, initializeFlightDetailMap, normalizeFlightDetailPayload, updateFlightScoreOverlay } from '../../public/scripts/flightDetailMap.js';

const emptyGeoJson = { type: 'FeatureCollection', features: [] };

function feature(type: string, coordinates: unknown) {
  return { type: 'Feature', properties: {}, geometry: { type, coordinates } };
}

function element(dataset: Record<string, string> = {}) {
  const listeners = new Map<string, () => void>();
  const attributes = new Map<string, string>();
  return {
    dataset,
    hidden: true,
    disabled: false,
    textContent: '',
    addEventListener: vi.fn((name: string, listener: () => void) => {
      listeners.set(name, listener);
    }),
    setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    click: () => listeners.get('click')?.(),
  };
}

function mapHarness() {
  let loadHandler: (() => Promise<void>) | undefined;
  let errorHandler: (() => void) | undefined;
  const sources = new Map<string, any>();
  const layers: any[] = [];
  const markers: any[] = [];
  const map = {
    addControl: vi.fn(),
    addSource: vi.fn((id: string, source: any) => {
      sources.set(id, { ...source, setData: vi.fn() });
    }),
    addLayer: vi.fn((layer: any) => layers.push(layer)),
    getLayer: vi.fn((id: string) => layers.find((layer) => layer.id === id)),
    removeLayer: vi.fn((id: string) => { const index = layers.findIndex((layer) => layer.id === id); if (index >= 0) layers.splice(index, 1); }),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    getPaintProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    fitBounds: vi.fn(),
    once: vi.fn((name: string, handler: any) => {
      if (name === 'load') loadHandler = handler;
      if (name === 'error') errorHandler = handler;
    }),
  };
  return {
    map,
    sources,
    layers,
    markers,
    maplibre: {
      Map: vi.fn(function Map() { return map; }),
      NavigationControl: vi.fn(function NavigationControl() {}),
      Marker: vi.fn(function Marker(this: any, options: any) {
        this.options = options; this.setLngLat = vi.fn(() => this); this.addTo = vi.fn(() => this); this.remove = vi.fn(); markers.push(this);
      }),
    },
    load: async () => loadHandler?.(),
    error: () => errorHandler?.(),
  };
}

function replayElements() {
  return {
    open: element(),
    panel: element(),
    status: element(),
    play: element(),
    label: element(),
    icon: element(),
    close: element(),
    slider: element(),
    elapsed: element(),
    speed: element(),
  };
}

describe('flight detail map', () => {
  it('normalizes missing optional GeoJSON and score entries', () => {
    const normalized = normalizeFlightDetailPayload({
      track: feature('LineString', [[-105, 39], [-104, 40]]),
      replay: { durationMs: 1000, points: [[-105, 39, 0]] },
      scores: { fivePoint: { legs: feature('LineString', [[-105, 39], [-104, 40]]) } },
    });

    expect(normalized.directCells).toEqual(emptyGeoJson);
    expect(normalized.scores.fivePoint.turnpoints).toEqual(emptyGeoJson);
    expect(normalized.scores.threePoint).toBeUndefined();
    expect(normalized.replay?.points).toEqual([[-105, 39, 0]]);
  });

  it('chooses a deterministic palette color with the greatest contrast', () => {
    expect(chooseContrastingTrackColor('#0b1935')).toBe('#ff681d');
    expect(chooseContrastingTrackColor('#ff681d')).toBe('#0b1935');
    expect(chooseContrastingTrackColor('not-a-color')).toBe('#0b1935');
  });

  it('calculates framing from the full track only', () => {
    expect(flightTrackBounds(feature('LineString', [
      [-105.5, 39.1],
      [-104.75, 40.25],
      [-106.1, 39.8],
    ]))).toEqual([[-106.1, 39.1], [-104.75, 40.25]]);
    expect(flightTrackBounds(emptyGeoJson)).toBeNull();
  });

  it('updates only scoring sources and clears them for Track', () => {
    const scoreLegs = { setData: vi.fn() };
    const scoreTurnpoints = { setData: vi.fn() };
    const track = { setData: vi.fn() };
    const map = {
      getSource: vi.fn((id: string) => new Map<string, any>([
        [FLIGHT_DETAIL_SOURCE_IDS.scoreLegs, scoreLegs],
        [FLIGHT_DETAIL_SOURCE_IDS.scoreTurnpoints, scoreTurnpoints],
        [FLIGHT_DETAIL_SOURCE_IDS.track, track],
      ]).get(id)),
    };
    const legs = feature('LineString', [[-105, 39], [-104, 40]]);
    const turnpoints = feature('MultiPoint', [[-105, 39], [-104, 40]]);
    const payload = { scores: { fivePoint: { legs, turnpoints } } };

    expect(updateFlightScoreOverlay(map, payload, 'fivePoint')).toBe('fivePoint');
    expect(scoreLegs.setData).toHaveBeenLastCalledWith(legs);
    expect(scoreTurnpoints.setData).toHaveBeenLastCalledWith(turnpoints);
    expect(track.setData).not.toHaveBeenCalled();

    expect(updateFlightScoreOverlay(map, payload, 'track')).toBe('track');
    expect(scoreLegs.setData).toHaveBeenLastCalledWith(emptyGeoJson);
    expect(scoreTurnpoints.setData).toHaveBeenLastCalledWith(emptyGeoJson);
    expect(track.setData).not.toHaveBeenCalled();
  });

  it('loads one authenticated payload, installs all layers, and fits the full track once', async () => {
    const harness = mapHarness();
    const mapElement = element({
      mapStyleUrl: '/map-style.json',
      mapDataUrl: '/flights/flight-1/map',
      territoryColor: '#1769aa',
      defaultDistance: 'fivePoint',
    });
    const status = element();
    const trackButton = element({ flightMapDistance: 'track' });
    const fivePointButton = element({ flightMapDistance: 'fivePoint' });
    const trackGeoJson = feature('LineString', [[-105.5, 39.1], [-104.75, 40.25]]);
    const scoreLegs = feature('MultiLineString', [[[-105.5, 39.1], [-104.75, 40.25]]]);
    const scoreTurnpoints = feature('MultiPoint', [[-105.5, 39.1], [-104.75, 40.25]]);
    const payload = {
      directCells: emptyGeoJson,
      enclosedCells: emptyGeoJson,
      track: trackGeoJson,
      launch: feature('Point', [-105.5, 39.1]),
      landing: feature('Point', [-104.75, 40.25]),
      scores: { fivePoint: { legs: scoreLegs, turnpoints: scoreTurnpoints } },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const documentRef = {
      querySelector: (selector: string) => new Map<string, any>([
        ['[data-flight-detail-map]', mapElement],
        ['[data-flight-map-status]', status],
      ]).get(selector) ?? null,
      querySelectorAll: (selector: string) => (
        selector === '[data-flight-map-distance]' ? [trackButton, fivePointButton] : []
      ),
    };

    const controller = initializeFlightDetailMap({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
    });
    await harness.load();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith('/flights/flight-1/map', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    expect(harness.maplibre.NavigationControl).toHaveBeenCalledOnce();
    expect(harness.map.addControl).toHaveBeenCalledOnce();
    expect(harness.map.addControl).toHaveBeenCalledWith(expect.anything(), 'top-right');
    expect(harness.map.addSource).toHaveBeenCalledTimes(7);
    expect(harness.layers.map((layer) => layer.id)).toEqual(expect.arrayContaining([
      'flight-detail-direct-cells-fill',
      'flight-detail-enclosed-cells-fill',
      'flight-detail-track',
      'flight-detail-score-legs',
      'flight-detail-score-turnpoints',
      'flight-detail-launch',
      'flight-detail-landing',
    ]));
    expect(harness.layers.find((layer) => layer.id === 'flight-detail-score-turnpoints').type)
      .toBe('circle');
    expect(harness.layers.find((layer) => layer.id === 'flight-detail-direct-cells-fill').paint)
      .toEqual({ 'fill-color': '#1769aa', 'fill-opacity': 0.42 });
    expect(harness.layers.find((layer) => layer.id === 'flight-detail-enclosed-cells-fill').paint)
      .toEqual({ 'fill-color': '#1769aa', 'fill-opacity': 0.2 });
    expect(
      harness.layers.find((layer) => layer.id === 'flight-detail-enclosed-cells-boundary').paint,
    ).toEqual(expect.objectContaining({
      'line-color': '#1769aa',
      'line-dasharray': [2, 2],
    }));
    expect(harness.map.fitBounds).toHaveBeenCalledOnce();
    expect(harness.map.fitBounds).toHaveBeenCalledWith(
      [[-105.5, 39.1], [-104.75, 40.25]],
      { padding: 48, maxZoom: 14, duration: 0 },
    );
    expect(controller?.selectedKey).toBe('fivePoint');
    expect(fivePointButton.setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'true');

    trackButton.click();
    expect(controller?.selectedKey).toBe('track');
    expect(harness.map.fitBounds).toHaveBeenCalledOnce();
    expect(harness.sources.get(FLIGHT_DETAIL_SOURCE_IDS.track).setData).not.toHaveBeenCalled();
    expect(
      harness.sources.get(FLIGHT_DETAIL_SOURCE_IDS.scoreLegs).setData,
    ).toHaveBeenLastCalledWith(emptyGeoJson);
  });

  it('falls back to Track when the default score is missing and reports request failures', async () => {
    const harness = mapHarness();
    const mapElement = element({
      mapStyleUrl: '/map-style.json',
      mapDataUrl: '/flights/flight-1/map',
      defaultDistance: 'fivePoint',
    });
    const status = element();
    const documentRef = {
      querySelector: (selector: string) => (
        selector === '[data-flight-detail-map]' ? mapElement : status
      ),
      querySelectorAll: () => [],
    };
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));

    const controller = initializeFlightDetailMap({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
    });
    await harness.load();

    expect(controller?.selectedKey).toBe('track');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Unable to load this flight map. Try again.');
  });

  it('initializes flight replay paused, preserves static sources, and cleans up on close', async () => {
    const harness = mapHarness();
    const replayDom = replayElements();
    const mapElement = element({ mapStyleUrl: '/map-style.json', mapDataUrl: '/flights/flight-1/map' });
    const status = element();
    const trackGeoJson = feature('LineString', [[-105, 39], [-104, 40]]);
    const payload = {
      track: trackGeoJson,
      replay: { flightId: 'flight-1', pilotUserId: 'pilot-1', points: [[-105, 39, 0, 1_500], [-104, 40, 1000, 1_600]], durationMs: 1000 },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const replayBySelector: Record<string, any[]> = {
      '[data-map-replay-open]': [replayDom.open], '[data-map-replay-panel]': [replayDom.panel],
      '[data-map-replay-status]': [replayDom.status], '[data-map-replay-play]': [replayDom.play],
      '[data-map-replay-play-label]': [replayDom.label], '[data-map-replay-play-icon]': [replayDom.icon],
      '[data-map-replay-close]': [replayDom.close], '[data-map-replay-slider]': [replayDom.slider],
      '[data-map-replay-elapsed]': [replayDom.elapsed], '[data-map-replay-speed]': [replayDom.speed],
    };
    const documentRef = {
      querySelector: (selector: string) => new Map<string, any>([
        ['[data-flight-detail-map]', mapElement], ['[data-flight-map-status]', status], ['[data-map-replay]', mapElement],
      ]).get(selector) ?? null,
      querySelectorAll: (selector: string) => selector === '[data-flight-map-distance]' ? [] : (replayBySelector[selector] ?? []),
      createElement: () => ({ className: '', textContent: '', children: [] as any[], style: { setProperty: vi.fn() }, setAttribute: vi.fn(), removeAttribute: vi.fn(), appendChild(child: any) { this.children.push(child); } }),
    };
    const controller = initializeFlightDetailMap({ documentRef, maplibre: harness.maplibre, fetchImpl });
    expect(replayDom.open.disabled).toBe(true);
    await harness.load();
    expect(controller?.replayControls).toBeDefined();
    expect(replayDom.open.disabled).toBe(false);
    expect(replayDom.play.disabled).toBe(true);

    replayDom.open.click();
    await Promise.resolve();
    expect(replayDom.panel.hidden).toBe(false);
    expect(replayDom.play.disabled).toBe(false);
    expect(replayDom.label.textContent).toBe('Play');
    expect(harness.map.getPaintProperty).not.toHaveBeenCalled();
    expect(harness.sources.get(FLIGHT_DETAIL_SOURCE_IDS.track).setData).not.toHaveBeenCalled();
    expect(harness.sources.get('map-replay-tracks').setData).toHaveBeenCalled();
    expect(harness.layers.find((layer) => layer.id === 'map-replay-tracks-line')).toBeDefined();
    expect(harness.markers).toHaveLength(1);
    expect(harness.markers[0].options.element.children[0].children.map((node: any) => node.textContent)).toEqual(['0 km/h', '1,500 m']);

    replayDom.close.click();
    expect(replayDom.panel.hidden).toBe(true);
    expect(harness.sources.has('map-replay-tracks')).toBe(false);
    expect(harness.sources.has(FLIGHT_DETAIL_SOURCE_IDS.track)).toBe(true);
    expect(harness.markers[0].remove).toHaveBeenCalledOnce();
  });

  it('keeps replay controls disabled and reports unavailable when replay payload is missing', async () => {
    const harness = mapHarness();
    const replayDom = replayElements();
    const mapElement = element({ mapStyleUrl: '/map-style.json', mapDataUrl: '/flights/flight-1/map' });
    const status = element();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ track: emptyGeoJson }), { status: 200 }));
    const replayBySelector: Record<string, any[]> = {
      '[data-map-replay-open]': [replayDom.open], '[data-map-replay-panel]': [replayDom.panel], '[data-map-replay-status]': [replayDom.status],
      '[data-map-replay-play]': [replayDom.play], '[data-map-replay-play-label]': [replayDom.label], '[data-map-replay-play-icon]': [replayDom.icon],
      '[data-map-replay-close]': [replayDom.close], '[data-map-replay-slider]': [replayDom.slider], '[data-map-replay-elapsed]': [replayDom.elapsed], '[data-map-replay-speed]': [replayDom.speed],
    };
    const documentRef = {
      querySelector: (selector: string) => selector === '[data-flight-detail-map]' ? mapElement : (selector === '[data-flight-map-status]' ? status : mapElement),
      querySelectorAll: (selector: string) => selector === '[data-flight-map-distance]' ? [] : (replayBySelector[selector] ?? []),
    };
    initializeFlightDetailMap({ documentRef, maplibre: harness.maplibre, fetchImpl });
    expect(replayDom.open.disabled).toBe(true);
    await harness.load();
    expect(replayDom.open.disabled).toBe(true);
    replayDom.open.click();
    await Promise.resolve();
    expect(replayDom.status.textContent).toBe('Replay unavailable.');
    expect(replayDom.play.disabled).toBe(true);
    expect(harness.sources.has('map-replay-tracks')).toBe(false);
  });
});
