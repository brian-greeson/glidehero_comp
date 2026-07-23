export function initializeMapSheet({ documentRef = document, swipeThreshold = 40 } = {}) {
  const sheet = documentRef.querySelector('[data-map-sheet]');
  const handle = documentRef.querySelector('[data-map-sheet-handle]');
  const label = documentRef.querySelector('[data-map-sheet-label]');
  if (!sheet || !handle) return;

  let startY = null;
  let moved = false;
  let suppressClick = false;

  function setExpanded(expanded) {
    sheet.classList.toggle('is-expanded', expanded);
    handle.setAttribute('aria-expanded', String(expanded));
    if (label) {
      const current = label.textContent || 'Expand map controls';
      label.textContent = current.replace(/^(Expand|Collapse)/, expanded ? 'Collapse' : 'Expand');
    }
  }

  handle.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setExpanded(!sheet.classList.contains('is-expanded'));
  });
  handle.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    startY = event.clientY;
    moved = false;
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (startY !== null && Math.abs(event.clientY - startY) > 8) moved = true;
  });
  handle.addEventListener('pointerup', (event) => {
    if (startY === null) return;
    const distance = startY - event.clientY;
    startY = null;
    suppressClick = moved;
    moved = false;
    if (Math.abs(distance) >= swipeThreshold) setExpanded(distance > 0);
  });
  handle.addEventListener('pointercancel', () => { startY = null; moved = false; });
}
