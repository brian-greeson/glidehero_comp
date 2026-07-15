export type CompetitionGridClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      ownerUserId: string;
      cellId: string;
      competitionMonth: string;
      cellSize: number;
      x: number;
      y: number;
    };
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
};

export function emptyCompetitionGridClaimGeoJson(): CompetitionGridClaimGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
