export type GridClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
};

export function emptyGridClaimGeoJson(): GridClaimGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
