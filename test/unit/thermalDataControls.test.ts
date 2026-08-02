import { describe, expect, it } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { processedThermalAreaLayer, processedThermalAreasUrl, processedThermalTooltipRows, thermalDrawingFeatures, thermalPolygonGeometry } from '../../public/scripts/admin/thermalData.js';

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

  it('builds a normalized viewport URL for processed polygons', () => {
    const bounds = { getWest: () => -106, getSouth: () => 38, getEast: () => -104, getNorth: () => 40 };
    expect(processedThermalAreasUrl(bounds)).toBe('/admin/api/thermal/areas?west=-106&south=38&east=-104&north=40');
  });

  it('uses band colors and the requested initial opacity', () => {
    const layer = processedThermalAreaLayer(0.6);
    expect(layer.layout.visibility).toBe('none');
    expect(layer.paint['fill-opacity']).toBe(0.6);
    expect(layer.paint['fill-color']).toContain('yellow_orange');
    expect(layer.paint['fill-color']).toContain('#dc2626');
  });

  it('formats the compact debug tooltip', () => {
    const formatter = { format: () => 'Aug 2, 2:32 PM MDT' };
    expect(processedThermalTooltipRows({
      activityBand: 'yellow_orange', relativeScore: 0.75, processedAt: '2026-08-02T20:32:00Z',
    }, formatter)).toEqual([
      'Band: Yellow/orange',
      'Score: 0.75',
      'Processed: Aug 2, 2:32 PM MDT',
    ]);
  });
});
