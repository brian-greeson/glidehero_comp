import type { MapPageModel } from '../models.js';

export type ProductionMapInput = {
  mode: MapPageModel['mode'];
  period: MapPageModel['period'];
  location: string | null;
  locationClearHref?: string;
  mapHref: string;
  currentUserId: string;
  territoryColor: string;
  mapStyleUrl?: string;
  mapModeHrefs?: MapPageModel['mapModeHrefs'];
  territoryTileMinimumZoom?: number;
  territoryTileMaximumZoom?: number;
  arenaSourceId?: number;
  focusArenaSourceId?: number;
};

/** Build an endpoint-backed map model. Map data is loaded by MapLibre after render. */
export function createMapPageModel(
  shell: Omit<MapPageModel, 'page' | 'mode' | 'period' | 'location' | 'leaderboard'>,
  input: ProductionMapInput,
): MapPageModel {
  return {
    ...shell,
    page: 'map',
    mode: input.mode,
    period: input.period,
    location: input.location,
    ...(input.locationClearHref ? { locationClearHref: input.locationClearHref } : {}),
    leaderboard: [],
    currentUserId: input.currentUserId,
    territoryColor: input.territoryColor,
    ...(input.mapModeHrefs ? { mapModeHrefs: input.mapModeHrefs } : {}),
    ...(input.mapStyleUrl ? { mapStyleUrl: input.mapStyleUrl } : {}),
    ...(input.territoryTileMinimumZoom === undefined ? {} : { territoryTileMinimumZoom: input.territoryTileMinimumZoom }),
    ...(input.territoryTileMaximumZoom === undefined ? {} : { territoryTileMaximumZoom: input.territoryTileMaximumZoom }),
    ...(input.arenaSourceId === undefined ? {} : { arenaSourceId: input.arenaSourceId }),
    ...(input.focusArenaSourceId === undefined ? {} : { focusArenaSourceId: input.focusArenaSourceId }),
  };
}
