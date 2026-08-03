function cellCenter(cell) {
  const ring = cell?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const coordinates = ring.filter((coordinate) =>
    Array.isArray(coordinate)
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1]));
  if (coordinates.length === 0) return null;
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  return [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  ];
}

function safeTimeZone(value) {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format(new Date());
    return value;
  } catch {
    return 'UTC';
  }
}

function flightDate(flight) {
  const date = flight?.startedAt ? new Date(flight.startedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: safeTimeZone(flight.launchTimezone),
  }).format(date);
}

function flightDistance(flight) {
  if (!Number.isFinite(flight?.distanceMeters)) return 'Distance unavailable';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(flight.distanceMeters / 1_000)} km`;
}

function claimantContent(documentRef, flights, colorForPilot) {
  const content = documentRef.createElement('section');
  content.className = 'cell-claimants';
  content.setAttribute('aria-label', 'Flights through this cell');

  const heading = documentRef.createElement('h2');
  heading.textContent = 'Flights';
  content.append(heading);

  if (flights.length === 0) {
    const empty = documentRef.createElement('p');
    empty.textContent = 'No flights claimed this cell during this period.';
    content.append(empty);
    return content;
  }

  const list = documentRef.createElement('ul');
  for (const flight of flights) {
    const item = documentRef.createElement('li');
    const link = documentRef.createElement('a');
    link.href = `/flights/${encodeURIComponent(flight.flightId)}`;
    link.setAttribute('aria-label', `View ${flight.displayName}'s flight from ${flightDate(flight)}`);
    const marker = documentRef.createElement('span');
    marker.className = 'cell-claimants-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.setProperty('--pilot-color', colorForPilot(flight.userId));
    const details = documentRef.createElement('span');
    details.className = 'cell-claimants-details';
    const name = documentRef.createElement('span');
    name.className = 'cell-claimants-name';
    name.textContent = flight.displayName;
    const summary = documentRef.createElement('small');
    summary.textContent = `${flightDate(flight)} · ${flightDistance(flight)}`;
    details.append(name, summary);
    link.append(marker, details);
    item.append(link);
    list.append(item);
  }
  content.append(list);
  return content;
}

export function createMapCellClaimantPopup({
  map,
  maplibre,
  documentRef = document,
  colorForPilot,
  onClose = () => undefined,
}) {
  let popup = null;

  function clear() {
    const current = popup;
    popup = null;
    current?.remove();
  }

  function render(result) {
    const center = cellCenter(result?.cell);
    if (!center || !maplibre?.Popup) {
      clear();
      return;
    }
    const content = claimantContent(
      documentRef,
      Array.isArray(result?.flights) ? result.flights : [],
      colorForPilot,
    );
    if (!popup) {
      const next = new maplibre.Popup({
        className: 'cell-claimants-popup',
        closeButton: true,
        closeOnClick: false,
        maxWidth: '18rem',
      });
      popup = next;
      next.on('close', () => {
        if (popup !== next) return;
        popup = null;
        onClose();
      });
      next.setLngLat(center).setDOMContent(content).addTo(map);
      return;
    }
    popup.setLngLat(center).setDOMContent(content);
  }

  return { clear, render };
}
