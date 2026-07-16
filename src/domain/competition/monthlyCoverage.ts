export type MonthlyCoveragePilot = {
  userId: string;
  displayName: string;
  claimedCellCount: number;
  exclusiveCellCount: number;
  sharedCellCount: number;
  claimedAreaSquareMeters: number;
  rank: number | null;
};

export type MonthlyCoverageLeaderboard = {
  leaders: MonthlyCoveragePilot[];
  currentPilot: MonthlyCoveragePilot | null;
};

export type MonthlyCoverageGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      cellId: string;
      cellSize: number;
      x: number;
      y: number;
      claimantCount: number;
      isShared: boolean;
      pilotUserId?: string;
    };
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
};

export type MonthlyCoverageCellClaimant = {
  userId: string;
  displayName: string;
};

export function emptyMonthlyCoverageGeoJson(): MonthlyCoverageGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
