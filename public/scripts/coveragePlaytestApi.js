import { viewportSearchParams } from './viewportQuery.js';

function periodValues(month) {
  return month ? { month } : {};
}

export function globalCoverageLeaderboardUrl(bounds, month = null) {
  return `/v1/playtest/coverage/global/leaderboard?${viewportSearchParams(bounds, periodValues(month))}`;
}

export function coverageTerritoryUrl({ arenaSourceId, month = null, pilotUserId = null }) {
  const params = new URLSearchParams(periodValues(month));
  if (pilotUserId) params.set('pilot', pilotUserId);
  const scope = arenaSourceId ? `arenas/${encodeURIComponent(arenaSourceId)}` : 'global';
  const query = params.toString();
  return `/v1/playtest/coverage/${scope}/territory${query ? `?${query}` : ''}`;
}

export function arenaCoverageLeaderboardUrl(arenaSourceId, month = null) {
  const params = new URLSearchParams(periodValues(month));
  const query = params.toString();
  return `/v1/playtest/coverage/arenas/${encodeURIComponent(arenaSourceId)}/leaderboard${query ? `?${query}` : ''}`;
}

export function coverageCellClaimantsUrl(x, y, month = null) {
  const params = new URLSearchParams(periodValues(month));
  const query = params.toString();
  return `/v1/playtest/coverage/cells/${encodeURIComponent(x)}/${encodeURIComponent(y)}/claimants${query ? `?${query}` : ''}`;
}
