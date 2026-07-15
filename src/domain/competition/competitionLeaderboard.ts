export type CompetitionLeaderboardPilot = {
  userId: string;
  displayName: string;
  claimedCellCount: number;
  claimedAreaSquareMeters: number;
  rank: number | null;
};

export type CompetitionLeaderboard = {
  leaders: CompetitionLeaderboardPilot[];
  currentPilot: CompetitionLeaderboardPilot | null;
};
