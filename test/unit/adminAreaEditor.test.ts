import { describe, expect, it } from 'vitest';
// The admin editor intentionally remains a standalone browser JavaScript module.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { areaCellKey, filterAndSortAreas, normalizeEditorLongitude } from '../../public/scripts/admin/areaEditor.js';

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
});
