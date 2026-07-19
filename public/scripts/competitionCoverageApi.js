import { viewportSearchParams } from './viewportQuery.js';

function periodValues(month) {
  return month ? { month } : {};
}

export function globalCoverageLeaderboardUrl(bounds, month = null) {
  return `/v1/competition-leaderboard?${viewportSearchParams(bounds, periodValues(month))}`;
}

export function coverageTerritoryUrl({ arenaSourceId, bounds, month = null, pilotUserId = null }) {
  const params = viewportSearchParams(bounds, periodValues(month));
  if (pilotUserId) params.set('pilot', pilotUserId);
  const path = arenaSourceId
    ? `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-territory`
    : '/v1/competition-territory';
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

export function arenaCoverageLeaderboardUrl(arenaSourceId, month = null) {
  const params = new URLSearchParams(periodValues(month));
  const query = params.toString();
  return `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-leaderboard${query ? `?${query}` : ''}`;
}

export function coverageCellClaimantsUrl(x, y, month = null) {
  const params = new URLSearchParams(periodValues(month));
  const query = params.toString();
  return `/v1/competition-cells/${encodeURIComponent(x)}/${encodeURIComponent(y)}/claimants${query ? `?${query}` : ''}`;
}
