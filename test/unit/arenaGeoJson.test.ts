import { describe, expect, it } from 'vitest';
import { extractPolygonGeometries } from '../../src/domain/arena/geoJson.js';
import { parseStateArenaGeoJson } from '../../src/services/stateArenaImportService.js';

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

describe('Arena GeoJSON', () => {
  it('extracts polygon components from supported GeoJSON containers and ignores non-polygons in mixed collections', () => {
    expect(extractPolygonGeometries(polygon)).toHaveLength(1);
    expect(extractPolygonGeometries({ type: 'Feature', properties: {}, geometry: polygon })).toHaveLength(1);
    expect(extractPolygonGeometries({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: polygon },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ] })).toHaveLength(1);
  });

  it('rejects malformed polygon coordinates', () => {
    expect(() => extractPolygonGeometries({ type: 'Polygon', coordinates: [[[0, 0]]] })).toThrow('malformed');
  });

  it('selects exactly the fifty states by Census identity', () => {
    const abbreviations = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
    const features = abbreviations.map((abbreviation, index) => ({
      type: 'Feature',
      properties: { NAME: `State ${abbreviation}`, STUSAB: abbreviation, STATE: String(index + 1).padStart(2, '0') },
      geometry: polygon,
    }));
    features.push({ type: 'Feature', properties: { NAME: 'District of Columbia', STUSAB: 'DC', STATE: '11' }, geometry: polygon });
    const states = parseStateArenaGeoJson({ type: 'FeatureCollection', features });
    expect(states).toHaveLength(50);
    expect(new Set(states.map((state) => state.fips)).size).toBe(50);
    expect(states.some((state) => state.abbreviation === 'DC')).toBe(false);
  });
});
