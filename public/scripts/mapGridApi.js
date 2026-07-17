export function viewportGridUrl(bounds) {
  const query = new URLSearchParams({
    west: String(bounds.getWest()),
    south: String(bounds.getSouth()),
    east: String(bounds.getEast()),
    north: String(bounds.getNorth()),
  });
  return `/v1/grid?${query}`;
}
export function arenaGridUrl(sourceId) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/grid`;
}
