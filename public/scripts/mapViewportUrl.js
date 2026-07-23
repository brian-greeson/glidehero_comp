const MAX_ZOOM = 24;

function finiteNumber(value) {
  if (value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mapViewportFromSearch(search = '') {
  const query = new URLSearchParams(search);
  const latitude = finiteNumber(query.get('lat'));
  const longitude = finiteNumber(query.get('lng'));
  const zoom = finiteNumber(query.get('zoom'));
  if (
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180 ||
    zoom === null || zoom < 0 || zoom > MAX_ZOOM
  ) return null;
  return { center: [longitude, latitude], zoom };
}

function rounded(value, digits) {
  return String(Number(value.toFixed(digits)));
}

export function updateMapModeLinks({
  documentRef = document,
  locationRef = globalThis.location,
  map,
  periodSelection,
}) {
  const center = map?.getCenter?.();
  const zoom = map?.getZoom?.();
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !Number.isFinite(zoom)) return;

  const origin = locationRef?.origin ?? 'http://localhost';
  const currentQuery = new URLSearchParams(locationRef?.search ?? '');
  for (const link of documentRef.querySelectorAll?.('[data-map-mode-link]') ?? []) {
    const url = new URL(link.getAttribute('href') || '/', origin);
    const month = periodSelection ? periodSelection.month : currentQuery.get('month');
    if (month) url.searchParams.set('month', month);
    else url.searchParams.delete('month');
    const period = periodSelection ? periodSelection.period : currentQuery.get('period');
    if (period === 'all-time' && !month) url.searchParams.set('period', period);
    else url.searchParams.delete('period');
    url.searchParams.set('lat', rounded(center.lat, 5));
    url.searchParams.set('lng', rounded(center.lng, 5));
    url.searchParams.set('zoom', rounded(zoom, 2));
    link.href = `${url.pathname}${url.search}`;
  }
}
