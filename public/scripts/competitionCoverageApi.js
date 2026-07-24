import { viewportSearchParams } from './viewportQuery.js';

function periodValues(month) {
  return month ? { month } : {};
}

function scopeValue(scope) {
  return scope === 'following' ? { scope } : {};
}

export function globalCoverageLeaderboardUrl(bounds, month = null, { scope = null } = {}) {
  return `/v1/competition-leaderboard?${viewportSearchParams(bounds, { ...periodValues(month), ...scopeValue(scope) })}`;
}

export function coverageTerritoryTileUrl(
  { arenaSourceId = null, month = null, pilotUserId = null, scope = null },
  origin = globalThis.location?.origin ?? '',
) {
  const params = new URLSearchParams(periodValues(month));
  if (scope === 'following') params.set('scope', scope);
  if (pilotUserId) params.set('pilot', pilotUserId);
  const path = arenaSourceId
    ? `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-territory/tiles/{z}/{x}/{y}.mvt`
    : '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt';
  const query = params.toString();
  return `${origin}${path}${query ? `?${query}` : ''}`;
}

export function arenaCoverageLeaderboardUrl(arenaSourceId, month = null, { scope = null } = {}) {
  const params = new URLSearchParams({ ...periodValues(month), ...scopeValue(scope) });
  const query = params.toString();
  return `/v1/arenas/${encodeURIComponent(arenaSourceId)}/competition-leaderboard${query ? `?${query}` : ''}`;
}

export function competitionCellTracksUrl(x, y, { month = null, pilotUserId = null, scope = null } = {}) {
  const params = new URLSearchParams(periodValues(month));
  if (scope === 'following') params.set('scope', scope);
  if (pilotUserId) params.set('pilot', pilotUserId);
  const query = params.toString();
  return `/v1/competition-cells/${encodeURIComponent(x)}/${encodeURIComponent(y)}/tracks${query ? `?${query}` : ''}`;
}
