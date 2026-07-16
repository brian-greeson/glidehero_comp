export function initializeMobileSheet({ documentRef = document, swipeThreshold = 40 } = {}) {
  const sheetToggle = documentRef.querySelector('[data-sheet-toggle]');
  const sheetToggleLabel = documentRef.querySelector('[data-sheet-toggle-label]');
  const sheet = documentRef.querySelector('[data-mobile-sheet]');
  if (!sheetToggle || !sheet) return;

  let expanded = sheet.classList.contains('is-expanded');
  let pointerStartY = null;
  let pointerMoved = false;
  let suppressClick = false;

  function setExpanded(nextExpanded) {
    expanded = nextExpanded;
    sheet.classList.toggle('is-expanded', expanded);
    sheetToggle.setAttribute('aria-expanded', String(expanded));
    if (sheetToggleLabel) {
      sheetToggleLabel.textContent = `${expanded ? 'Collapse' : 'Expand'} map information`;
    }
  }

  sheetToggle.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setExpanded(!expanded);
  });

  sheetToggle.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    pointerStartY = event.clientY;
    pointerMoved = false;
    sheetToggle.setPointerCapture?.(event.pointerId);
  });

  sheetToggle.addEventListener('pointermove', (event) => {
    if (pointerStartY === null) return;
    if (Math.abs(event.clientY - pointerStartY) > 8) pointerMoved = true;
  });

  function finishSwipe(event) {
    if (pointerStartY === null) return;
    const distance = pointerStartY - event.clientY;
    pointerStartY = null;
    suppressClick = pointerMoved;
    pointerMoved = false;
    if (Math.abs(distance) < swipeThreshold) return;
    setExpanded(distance > 0);
  }

  sheetToggle.addEventListener('pointerup', finishSwipe);
  sheetToggle.addEventListener('pointercancel', () => {
    pointerStartY = null;
    pointerMoved = false;
  });
}
