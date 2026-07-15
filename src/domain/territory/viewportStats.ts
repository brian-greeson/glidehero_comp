export type ViewportStats = {
  claimedCellCount: number;
  claimedAreaSquareMeters: number;
  flightCount: number;
  visibleCellCount: number;
  claimedPercentage: number;
};

export type CompetitionViewportStats = ViewportStats & {
  pilotCount: number;
  currentPilotFlightCount: number;
};

export function emptyViewportStats(): ViewportStats {
  return {
    claimedCellCount: 0,
    claimedAreaSquareMeters: 0,
    flightCount: 0,
    visibleCellCount: 0,
    claimedPercentage: 0,
  };
}

export function emptyCompetitionViewportStats(): CompetitionViewportStats {
  return {
    ...emptyViewportStats(),
    pilotCount: 0,
    currentPilotFlightCount: 0,
  };
}
