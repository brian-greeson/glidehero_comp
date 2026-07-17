function wrapLongitude(longitude, isEast = false) {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && isEast && longitude > 0) return 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function normalizeViewportBounds(bounds) {
  const rawWest = bounds.getWest();
  const rawEast = bounds.getEast();
  if (rawEast - rawWest >= 360) {
    return { west: -180, south: bounds.getSouth(), east: 180, north: bounds.getNorth() };
  }
  return {
    west: wrapLongitude(rawWest),
    south: bounds.getSouth(),
    east: wrapLongitude(rawEast, true),
    north: bounds.getNorth(),
  };
}

export function viewportSearchParams(bounds, values = {}) {
  const normalized = normalizeViewportBounds(bounds);
  return new URLSearchParams({
    ...values,
    west: String(normalized.west),
    south: String(normalized.south),
    east: String(normalized.east),
    north: String(normalized.north),
  });
}

export function personalStatsUrl(bounds) {
  return `/v1/personal-stats?${viewportSearchParams(bounds)}`;
}
