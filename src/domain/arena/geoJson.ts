export type PolygonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

function validPosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function validRing(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length >= 4 && value.every(validPosition);
}

function polygon(value: unknown): PolygonGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length || !geometry.coordinates.every(validRing)) {
      throw new TypeError('Polygon coordinates are malformed.');
    }
    return geometry as PolygonGeometry;
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length
      || !geometry.coordinates.every((part) => Array.isArray(part) && part.length && part.every(validRing))) {
      throw new TypeError('MultiPolygon coordinates are malformed.');
    }
    return geometry as PolygonGeometry;
  }
  return null;
}

export function extractPolygonGeometries(value: unknown): PolygonGeometry[] {
  const direct = polygon(value);
  if (direct) return [direct];
  if (!value || typeof value !== 'object') throw new TypeError('GeoJSON must be an object.');
  const item = value as { type?: unknown; geometry?: unknown; features?: unknown };
  if (item.type === 'Feature') {
    const geometry = polygon(item.geometry);
    return geometry ? [geometry] : [];
  }
  if (item.type === 'FeatureCollection') {
    if (!Array.isArray(item.features)) throw new TypeError('FeatureCollection features are malformed.');
    return item.features.flatMap((feature) => {
      if (!feature || typeof feature !== 'object' || (feature as { type?: unknown }).type !== 'Feature') {
        throw new TypeError('FeatureCollection contains a malformed feature.');
      }
      const geometry = polygon((feature as { geometry?: unknown }).geometry);
      return geometry ? [geometry] : [];
    });
  }
  throw new TypeError('Only Polygon, MultiPolygon, Feature, and FeatureCollection GeoJSON are supported.');
}
