import { viewportSearchParams } from './viewportQuery.js';

export function viewportGridUrl(bounds) {
  return `/v1/grid?${viewportSearchParams(bounds)}`;
}
export function arenaGridUrl(sourceId, bounds) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/grid?${viewportSearchParams(bounds)}`;
}
