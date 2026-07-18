import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { createLargeAreaSelection, createUnsavedActionGate, extractImportedPolygonFeatures, largeAreaPreviewPayload, polygonComponentCount } from '../../public/scripts/admin/polygonAreaEditor.js';

describe('Large Arena GeoJSON import', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

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
    expect(largeAreaPreviewPayload(bounds, { type: 'FeatureCollection', features: [] })).toEqual({
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
    const selection = createLargeAreaSelection({ load, apply });

    const firstRun = selection.run('first');
    const secondRun = selection.run('second');
    second.resolve({ id: 'second' });
    await secondRun;
    first.resolve({ id: 'first' });
    await firstRun;

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ id: 'second' });
  });
});
