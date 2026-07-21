import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { MAPLIBRE_DRAW_STYLES, adminAreaSavePayload, arenaTypeLabel, areaPreviewPayload, countryOptionForArea, createAreaSelection, createUnsavedActionGate, enableMapLibreDrawControls, extractImportedPolygonFeatures, filterAndSortAreas, nextAreaSort, polygonComponentCount } from '../../public/scripts/admin/polygonAreaEditor.js';

describe('Arena GeoJSON import', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

  it('uses MapLibre-compatible literal arrays for the Draw line dash style', () => {
    const lineStyle = MAPLIBRE_DRAW_STYLES.find((style: { id: string; paint?: Record<string, unknown> }) => style.id === 'gl-draw-lines');

    expect(lineStyle?.paint?.['line-dasharray']).toEqual([
      'case', ['==', ['get', 'active'], 'true'], ['literal', [0.2, 2]], ['literal', [2, 0]],
    ]);
  });

  it('adds the class aliases MapLibre and Mapbox Draw need to share controls and map events', () => {
    const elements = new Map([
      ['.maplibregl-canvas', { classList: { add: vi.fn() } }],
      ['.maplibregl-canvas-container', { classList: { add: vi.fn() } }],
      ['.mapboxgl-ctrl-group', { classList: { add: vi.fn() } }],
    ]);
    const mapNode = {
      classList: { add: vi.fn() },
      querySelector: vi.fn((selector: string) => elements.get(selector)),
    };

    enableMapLibreDrawControls(mapNode);

    expect(mapNode.classList.add).toHaveBeenCalledWith('mapboxgl-map');
    expect(elements.get('.maplibregl-canvas')?.classList.add).toHaveBeenCalledWith('mapboxgl-canvas');
    expect(elements.get('.maplibregl-canvas-container')?.classList.add).toHaveBeenCalledWith('mapboxgl-canvas-container', 'mapboxgl-interactive');
    expect(elements.get('.mapboxgl-ctrl-group')?.classList.add).toHaveBeenCalledWith('maplibregl-ctrl', 'maplibregl-ctrl-group');
  });

  it('adds Polygon, MultiPolygon, Feature, and mixed FeatureCollection inputs to one draft', () => {
    expect(extractImportedPolygonFeatures(polygon)).toHaveLength(1);
    expect(extractImportedPolygonFeatures({ type: 'MultiPolygon', coordinates: [polygon.coordinates, polygon.coordinates] })).toHaveLength(2);
    expect(extractImportedPolygonFeatures({ type: 'Feature', properties: {}, geometry: polygon })).toHaveLength(1);
    expect(extractImportedPolygonFeatures({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: polygon },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ] })).toHaveLength(1);
  });

  it('rejects input with no polygon geometry', () => {
    expect(() => extractImportedPolygonFeatures({ type: 'Point', coordinates: [0, 0] })).toThrow('does not contain polygon');
  });

  it('counts normalized MultiPolygon components rather than draw features', () => {
    expect(polygonComponentCount({ features: [{
      geometry: { type: 'MultiPolygon', coordinates: [polygon.coordinates, polygon.coordinates] },
    }] })).toBe(2);
  });

  it('normalizes shifted antimeridian bounds for cell previews', () => {
    const bounds = { getWest: () => 172, getSouth: () => 51, getEast: () => 230, getNorth: () => 72 };
    expect(areaPreviewPayload(bounds, { type: 'FeatureCollection', features: [] })).toEqual({
      west: 172, south: 51, east: -130, north: 72,
      geojson: { type: 'FeatureCollection', features: [] },
    });
  });

  it('requires an explicit dialog decision before replacing a dirty draft', async () => {
    const action = vi.fn();
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const save = vi.fn(async () => true);
    const gate = createUnsavedActionGate({ isDirty: () => true, dialog, save });

    await gate.request(action);
    expect(action).not.toHaveBeenCalled();
    expect(dialog.showModal).toHaveBeenCalledOnce();

    await gate.handle('cancel');
    expect(action).not.toHaveBeenCalled();
    await gate.request(action);
    await gate.handle('discard');
    expect(action).toHaveBeenCalledOnce();
  });

  it('saves before continuing and keeps the dialog open if saving fails', async () => {
    const action = vi.fn();
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const gate = createUnsavedActionGate({ isDirty: () => true, dialog, save });

    await gate.request(action);
    await gate.handle('save');
    expect(action).not.toHaveBeenCalled();
    expect(dialog.close).not.toHaveBeenCalled();

    await gate.handle('save');
    expect(action).toHaveBeenCalledOnce();
    expect(dialog.close).toHaveBeenCalledOnce();
  });

  it('allows only the latest Arena selection to update the editor', async () => {
    const first = Promise.withResolvers<{ id: string }>();
    const second = Promise.withResolvers<{ id: string }>();
    const apply = vi.fn();
    const load = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const selection = createAreaSelection({ load, apply });

    const firstRun = selection.run('first');
    const secondRun = selection.run('second');
    second.resolve({ id: 'second' });
    await secondRun;
    first.resolve({ id: 'first' });
    await firstRun;

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ id: 'second' });
  });

  it('filters by optional city and sorts the unified Arena list', () => {
    const areas = [
      { name: 'Zulu', country: 'United States', state: 'Colorado', city: 'Golden' },
      { name: 'Alpha', country: 'Switzerland', state: 'Bern', city: '' },
    ];
    expect(filterAndSortAreas(areas, 'golden').map((area: { name: string }) => area.name)).toEqual(['Zulu']);
    expect(filterAndSortAreas(areas, '').map((area: { name: string }) => area.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('renders readable type labels, resolves an existing country selection, and posts only countryArenaId', () => {
    expect(['launch', 'general', 'state', 'country'].map(arenaTypeLabel)).toEqual(['Launch', 'General', 'State', 'Country']);
    const countries = [{ id: 'country-1', sourceId: 3000000001, name: 'United States', countryCode: 'US' }];
    expect(countryOptionForArea(countries, { countryCode: 'US' })).toEqual(countries[0]);
    expect(adminAreaSavePayload({ name: 'Boulder', countryArenaId: countries[0]!.id, state: 'CO', city: '', country: 'United States' }, { type: 'FeatureCollection', features: [] })).toEqual({
      name: 'Boulder', countryArenaId: 'country-1', state: 'CO', city: '', geojson: { type: 'FeatureCollection', features: [] },
    });
    expect(adminAreaSavePayload({ name: 'Boulder', countryArenaId: 'country-1', country: 'United States' }, {}).country).toBeUndefined();
  });

  it('toggles the active sort direction and resets direction for a new column', () => {
    expect(nextAreaSort('country')).toEqual({ sortColumn: 'country', sortDirection: 'asc' });
    expect(nextAreaSort('name', 'name', 'asc')).toEqual({ sortColumn: 'name', sortDirection: 'desc' });
    expect(nextAreaSort('country', 'name', 'desc')).toEqual({ sortColumn: 'country', sortDirection: 'asc' });
  });
});
