import { initializeArenaSearch } from '../arenaSearch.js';
import { initializeCompetitionCoverage } from '../competitionCoverageController.js';
import { initializePersonalDashboard } from '../personalDashboard.js';

function browserMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function initializeMapUrlControls({ documentRef = document, locationRef = globalThis.location, now = () => new Date() } = {}) {
  const origin = locationRef?.origin ?? 'http://localhost';
  const currentPath = locationRef?.pathname ?? '/map';
  for (const link of documentRef.querySelectorAll?.('[data-map-period-link]') ?? []) {
    const url = new URL(link.getAttribute('href') || currentPath, origin);
    const period = link.dataset.mapPeriodLink;
    if (period === 'current-month') url.searchParams.set('month', browserMonth(now()));
    else url.searchParams.delete('month');
    link.href = `${url.pathname}${url.search}`;
  }
  for (const trigger of documentRef.querySelectorAll?.('[data-map-location-trigger]') ?? []) {
    trigger.addEventListener('click', () => {
      const search = documentRef.querySelector('[data-map-arena-search]');
      if (!search) return;
      search.querySelector('input')?.focus?.();
    });
  }
}

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
    if (label) label.textContent = `${expanded ? 'Collapse' : 'Expand'} map controls`;
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

export function initializeMapPage({ documentRef = document, maplibre = globalThis.window?.maplibregl, fetchImpl = globalThis.fetch?.bind(globalThis), locationRef = globalThis.location, historyRef = globalThis.history, now = () => new Date(), navigatorRef = globalThis.navigator, storage } = {}) {
  initializeMapSheet({ documentRef });
  initializeMapUrlControls({ documentRef, locationRef, now });
  initializeArenaSearch({ documentRef, fetchImpl: fetchImpl ?? globalThis.fetch?.bind(globalThis), locationRef });
  const root = documentRef.querySelector('[data-map-page]');
  if (!root || root.dataset.mapPreview === 'true') return;
  if (!maplibre || !fetchImpl) return;
  if (root.dataset.dashboardMode === 'personal') {
    initializePersonalDashboard({ documentRef, maplibre, fetchImpl, locationRef, navigatorRef, storage });
  } else if (root.hasAttribute('data-competition-coverage')) {
    initializeCompetitionCoverage({ documentRef, maplibre, fetchImpl, locationRef, historyRef, now, navigatorRef, storage });
  }
}

if (typeof document !== 'undefined') initializeMapPage();
