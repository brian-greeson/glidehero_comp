import { describe, expect, it } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { thermalDrawingFeatures, thermalPolygonGeometry } from '../../public/scripts/admin/thermalData.js';

describe('thermal admin drawing controls', () => {
  const points = [[-105.2, 39], [-105, 39], [-105, 39.2], [-105.2, 39.2]];

  it('closes a finished polygon for the crawl request', () => {
    const geometry = thermalPolygonGeometry(points);
    expect(geometry).toEqual({
      type: 'Polygon',
      coordinates: [[...points, points[0]]],
    });
    expect(geometry.coordinates[0]?.at(-1)).toEqual(points[0]);
  });

  it('renders an open preview before finish and a polygon afterward', () => {
    const preview = thermalDrawingFeatures(points.slice(0, 2), false);
    expect(preview.features[0]?.geometry.type).toBe('LineString');

    const finished = thermalDrawingFeatures(points, true);
    expect(finished.features[0]?.geometry.type).toBe('Polygon');
    expect(finished.features).toHaveLength(points.length + 1);
  });

  it('requires at least three points', () => {
    expect(() => thermalPolygonGeometry(points.slice(0, 2))).toThrow('at least three points');
  });
});
