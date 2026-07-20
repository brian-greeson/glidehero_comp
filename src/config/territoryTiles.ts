export type TerritoryTileZoomRange = {
  minimumZoom: number;
  maximumZoom: number;
};

export type TerritoryTileConfig = {
  personal: TerritoryTileZoomRange;
  competition: TerritoryTileZoomRange;
};

export const territoryTileConfig: TerritoryTileConfig = {
  personal: {
    minimumZoom: 4,
    maximumZoom: 14,
  },
  competition: {
    minimumZoom: 4,
    maximumZoom: 14,
  },
};
