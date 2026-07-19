function wrapLongitude(longitude, isEast = false) {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && isEast && longitude > 0) return 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function boundValue(bounds, name) {
  const getter = bounds[`get${name[0].toUpperCase()}${name.slice(1)}`];
  return typeof getter === 'function' ? getter.call(bounds) : bounds[name];
}

export function normalizeViewportBounds(bounds) {
  const rawWest = boundValue(bounds, 'west');
  const rawEast = boundValue(bounds, 'east');
  if (rawEast - rawWest >= 360) {
    return { west: -180, south: boundValue(bounds, 'south'), east: 180, north: boundValue(bounds, 'north') };
  }
  return {
    west: wrapLongitude(rawWest),
    south: boundValue(bounds, 'south'),
    east: wrapLongitude(rawEast, true),
    north: boundValue(bounds, 'north'),
  };
}

export function expandViewportBounds(bounds, ratio = 0.5) {
  const normalized = normalizeViewportBounds(bounds);
  const longitudeWidth = normalized.east >= normalized.west
    ? normalized.east - normalized.west
    : 360 - normalized.west + normalized.east;
  const expandedLongitudeWidth = Math.min(360, longitudeWidth * (1 + 2 * ratio));
  const latitudeHeight = normalized.north - normalized.south;
  const south = Math.max(-90, normalized.south - latitudeHeight * ratio);
  const north = Math.min(90, normalized.north + latitudeHeight * ratio);
  if (expandedLongitudeWidth >= 360) return { west: -180, south, east: 180, north };
  const center = normalized.west + longitudeWidth / 2;
  return {
    west: wrapLongitude(center - expandedLongitudeWidth / 2),
    south,
    east: wrapLongitude(center + expandedLongitudeWidth / 2, true),
    north,
  };
}

function longitudeIntervals(bounds) {
  if (bounds.west === -180 && bounds.east === 180) return [[-180, 180]];
  return bounds.west <= bounds.east
    ? [[bounds.west, bounds.east]]
    : [[bounds.west, 180], [-180, bounds.east]];
}

export function viewportContains(outerBounds, innerBounds) {
  const outer = normalizeViewportBounds(outerBounds);
  const inner = normalizeViewportBounds(innerBounds);
  if (outer.south > inner.south || outer.north < inner.north) return false;
  const outerIntervals = longitudeIntervals(outer);
  return longitudeIntervals(inner).every(([innerWest, innerEast]) =>
    outerIntervals.some(([outerWest, outerEast]) => outerWest <= innerWest && outerEast >= innerEast));
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
