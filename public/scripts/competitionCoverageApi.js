import { viewportSearchParams } from './viewportQuery.js';

function periodValues(month) {
  return month ? { month } : {};
}

export function globalCoverageLeaderboardUrl(bounds, month = null) {
  return `/v1/competition-leaderboard?${viewportSearchParams(bounds, periodValues(month))}`;
}

export function coverageTerritoryTileUrl(
  { arenaSourceId = null, month = null, pilotUserId = null },
  origin = globalThis.location?.origin ?? '',
) {
  const params = new URLSearchParams(periodValues(month));
  if (pilotUserId) params.set('pilot', pilotUserId);
  const path = arenaSourceId
    ? `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-territory/tiles/{z}/{x}/{y}.mvt`
    : '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt';
  const query = params.toString();
  return `${origin}${path}${query ? `?${query}` : ''}`;
}

export function arenaCoverageLeaderboardUrl(arenaSourceId, month = null) {
  const params = new URLSearchParams(periodValues(month));
  const query = params.toString();
  return `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-leaderboard${query ? `?${query}` : ''}`;
}

export function competitionCellTracksUrl(x, y, { month = null, pilotUserId = null } = {}) {
  const params = new URLSearchParams(periodValues(month));
  if (pilotUserId) params.set('pilot', pilotUserId);
  const query = params.toString();
  return `/v1/competition-cells/${encodeURIComponent(x)}/${encodeURIComponent(y)}/tracks${query ? `?${query}` : ''}`;
}
