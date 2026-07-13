export type GeoJsonPosition = [longitude: number, latitude: number];
export type GeoJsonLinearRing = GeoJsonPosition[];
export type GeoJsonPolygonCoordinates = GeoJsonLinearRing[];

export type FreePolygonClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: {
      type: 'MultiPolygon';
      coordinates: GeoJsonPolygonCoordinates[];
    };
  }>;
};

export function emptyFreePolygonClaimGeoJson(): FreePolygonClaimGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
