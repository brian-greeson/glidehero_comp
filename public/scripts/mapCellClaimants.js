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

function claimantContent(documentRef, pilots, colorForPilot) {
  const content = documentRef.createElement('section');
  content.className = 'cell-claimants';
  content.setAttribute('aria-label', 'Pilots who claimed this cell');

  const heading = documentRef.createElement('h2');
  heading.textContent = 'Pilots';
  content.append(heading);

  if (pilots.length === 0) {
    const empty = documentRef.createElement('p');
    empty.textContent = 'No pilots claimed this cell during this period.';
    content.append(empty);
    return content;
  }

  const list = documentRef.createElement('ul');
  for (const pilot of pilots) {
    const item = documentRef.createElement('li');
    const marker = documentRef.createElement('span');
    marker.className = 'cell-claimants-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.setProperty('--pilot-color', colorForPilot(pilot.userId));
    const name = documentRef.createElement('span');
    name.textContent = pilot.displayName;
    item.append(marker, name);
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
      Array.isArray(result?.pilots) ? result.pilots : [],
      colorForPilot,
    );
    if (!popup) {
      const next = new maplibre.Popup({
        className: 'cell-claimants-popup',
        closeButton: true,
        closeOnClick: false,
        maxWidth: '16rem',
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
