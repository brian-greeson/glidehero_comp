const STATES = ['collapsed', 'partial', 'expanded'];

export function initializeMapSheet({ documentRef = document, swipeThreshold = 40 } = {}) {
  const sheet = documentRef.querySelector('[data-map-sheet]');
  const handle = documentRef.querySelector('[data-map-sheet-handle]');
  const label = documentRef.querySelector('[data-map-sheet-label]');
  if (!sheet || !handle) return;
  const sheetName = sheet.getAttribute?.('aria-label')?.trim().toLocaleLowerCase() || 'flight browser';

  let startY = null;
  let moved = false;
  let suppressClick = false;

  function setState(state) {
    const next = STATES.includes(state) ? state : 'partial';
    sheet.dataset.sheetState = next;
    for (const value of STATES) sheet.classList.toggle(`is-${value}`, value === next);
    handle.setAttribute('aria-expanded', String(next === 'expanded'));
    if (label) label.textContent = `${next === 'expanded' ? 'Collapse' : 'Expand'} ${sheetName}`;
  }

  handle.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const current = STATES.indexOf(sheet.dataset.sheetState || 'partial');
    setState(STATES[(current + 1) % STATES.length]);
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
    if (Math.abs(distance) >= swipeThreshold) {
      const current = STATES.indexOf(sheet.dataset.sheetState || 'partial');
      setState(STATES[Math.max(0, Math.min(STATES.length - 1, current + (distance > 0 ? 1 : -1)))]);
    }
  });
  handle.addEventListener('pointercancel', () => { startY = null; moved = false; });
  setState(sheet.dataset.sheetState || 'partial');
  return { setState, getState: () => sheet.dataset.sheetState };
}
