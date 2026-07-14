export type CompetitionGridClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { ownerUserId: string };
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
};

export function emptyCompetitionGridClaimGeoJson(): CompetitionGridClaimGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
