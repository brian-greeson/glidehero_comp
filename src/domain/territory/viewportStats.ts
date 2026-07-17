export type ViewportStats = {
  claimedCellCount: number;
  claimedAreaSquareMeters: number;
  flightCount: number;
};

export function emptyViewportStats(): ViewportStats {
  return {
    claimedCellCount: 0,
    claimedAreaSquareMeters: 0,
    flightCount: 0,
  };
}
