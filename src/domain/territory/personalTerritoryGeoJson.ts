export type GeoJsonPosition = [longitude: number, latitude: number];
export type GeoJsonLinearRing = GeoJsonPosition[];
export type GeoJsonPolygonCoordinates = GeoJsonLinearRing[];

export type PersonalTerritoryGeoJson = {
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

export function emptyPersonalTerritoryGeoJson(): PersonalTerritoryGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
