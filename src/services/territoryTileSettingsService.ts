import {
  territoryTileConfig,
  type TerritoryTileConfig,
  type TerritoryTileZoomRange,
} from '../config/territoryTiles.js';

export const MINIMUM_TERRITORY_TILE_ZOOM = 0;
export const MAXIMUM_TERRITORY_TILE_ZOOM = 22;

export interface TerritoryTileSettingsService {
  get(): TerritoryTileConfig;
  update(settings: TerritoryTileConfig): void;
}

function copy(settings: TerritoryTileConfig): TerritoryTileConfig {
  return {
    personal: { ...settings.personal },
    competition: { ...settings.competition },
  };
}

function isValidRange(range: TerritoryTileZoomRange): boolean {
  return Number.isInteger(range.minimumZoom)
    && Number.isInteger(range.maximumZoom)
    && range.minimumZoom >= MINIMUM_TERRITORY_TILE_ZOOM
    && range.maximumZoom <= MAXIMUM_TERRITORY_TILE_ZOOM
    && range.minimumZoom <= range.maximumZoom;
}

export function createTerritoryTileSettingsService(
  defaults: TerritoryTileConfig = territoryTileConfig,
): TerritoryTileSettingsService {
  if (!isValidRange(defaults.personal) || !isValidRange(defaults.competition)) {
    throw new RangeError('Territory tile zoom settings are invalid.');
  }
  let current = copy(defaults);

  return {
    get: () => copy(current),
    update(settings) {
      if (!isValidRange(settings.personal) || !isValidRange(settings.competition)) {
        throw new RangeError('Territory tile zoom settings are invalid.');
      }
      current = copy(settings);
    },
  };
}
