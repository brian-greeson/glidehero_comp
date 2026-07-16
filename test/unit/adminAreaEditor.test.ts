import { describe, expect, it } from 'vitest';
// The admin editor intentionally remains a standalone browser JavaScript module.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { areaCellKey, createLatestRequestGate, filterAndSortAreas, newAreaEditorView, normalizeEditorLongitude, parseEditorCoordinates } from '../../public/scripts/admin/areaEditor.js';

const areas = [
  { id: '1', sourceId: 1, name: 'Zulu', country: 'United States', state: 'Colorado' },
  { id: '2', sourceId: 2, name: 'Alpha', country: 'Switzerland', state: 'Bern' },
  { id: '3', sourceId: 3, name: 'Bravo', country: 'United States', state: 'Utah' },
];

describe('admin area editor state helpers', () => {
  it('filters across name, country, and state and sorts by selectable columns', () => {
    expect((filterAndSortAreas(areas, 'united') as typeof areas).map((area) => area.name)).toEqual(['Bravo', 'Zulu']);
    expect((filterAndSortAreas(areas, '', 'state') as typeof areas).map((area) => area.state)).toEqual(['Bern', 'Colorado', 'Utah']);
    expect((filterAndSortAreas(areas, '', 'name', 'desc') as typeof areas).map((area) => area.name)).toEqual(['Zulu', 'Bravo', 'Alpha']);
  });

  it('uses stable projected cell coordinates as the local edit identity', () => {
    expect(areaCellKey({ properties: { x: -10, y: 22 } })).toBe('-10:22');
  });

  it('normalizes wrapped map bounds for the server viewport contract', () => {
    expect(normalizeEditorLongitude(181)).toBe(-179);
    expect(normalizeEditorLongitude(-181)).toBe(179);
    expect(normalizeEditorLongitude(180)).toBe(-180);
  });

  it('zooms a new launch location to a scale where game cells can be painted', () => {
    expect(newAreaEditorView(39.7392, -104.9903, 5)).toEqual({
      center: [-104.9903, 39.7392],
      zoom: 13,
    });
    expect(newAreaEditorView(39.7392, -104.9903, 15).zoom).toBe(15);
  });

  it('allows only the latest asynchronous editor request to update state', () => {
    const gate = createLatestRequestGate();
    const first = gate.start();
    const second = gate.start();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
    gate.invalidate();
    expect(second()).toBe(false);
  });

  it('requires a complete in-range coordinate pair before updating the map', () => {
    expect(parseEditorCoordinates('39.7392', '')).toBeNull();
    expect(parseEditorCoordinates('', '-104.9903')).toBeNull();
    expect(parseEditorCoordinates('91', '-104.9903')).toBeNull();
    expect(parseEditorCoordinates('39.7392', '-181')).toBeNull();
    expect(parseEditorCoordinates('0', '0')).toEqual({ latitude: 0, longitude: 0 });
  });
});
