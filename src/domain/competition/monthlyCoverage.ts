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

export type MonthlyCoverageCellClaimant = {
  userId: string;
  displayName: string;
};
