import { initializeArenaSearch } from '../arenaSearch.js';
import { initializeCompetitionCoverage } from '../competitionCoverageController.js';
import {
  ALL_TIME_COMPETITION_PERIOD,
  mapPeriodFromSearch,
} from '../competitionPeriod.js';
import { initializePersonalDashboard } from '../personalDashboard.js';
import { initializeMapSheet } from './mapSheet.js';

export { initializeMapSheet } from './mapSheet.js';

export function initializeMapUrlControls({
  documentRef = document,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  now = () => new Date(),
} = {}) {
  const origin = locationRef?.origin ?? 'http://localhost';
  const currentPath = locationRef?.pathname ?? '/map';
  const currentDate = now();
  const selection = mapPeriodFromSearch(locationRef?.search ?? '', currentDate);
  const currentBrowserMonth = mapPeriodFromSearch('', currentDate).month;
  const currentQuery = new URLSearchParams(locationRef?.search ?? '');
  currentQuery.delete('month');
  currentQuery.delete('period');
  if (selection.month) currentQuery.set('month', selection.month);
  else currentQuery.set('period', ALL_TIME_COMPETITION_PERIOD);
  const canonicalUrl = `${currentPath}?${currentQuery}`;
  if (`${currentPath}${locationRef?.search ?? ''}` !== canonicalUrl) {
    historyRef?.replaceState?.(null, '', canonicalUrl);
  }
  for (const link of documentRef.querySelectorAll?.('[data-map-period-link]') ?? []) {
    const url = new URL(link.getAttribute('href') || currentPath, origin);
    const period = link.dataset.mapPeriodLink;
    url.searchParams.delete('month');
    url.searchParams.delete('period');
    if (period === 'current-month') url.searchParams.set('month', currentBrowserMonth);
    else url.searchParams.set('period', ALL_TIME_COMPETITION_PERIOD);
    link.href = `${url.pathname}${url.search}`;
  }
  for (const trigger of documentRef.querySelectorAll?.('[data-map-location-trigger]') ?? []) {
    trigger.addEventListener('click', () => {
      const search = documentRef.querySelector('[data-map-arena-search]');
      if (!search) return;
      search.querySelector('input')?.focus?.();
    });
  }
  return selection;
}

export function initializeMapPage({ documentRef = document, maplibre = globalThis.window?.maplibregl, fetchImpl = globalThis.fetch?.bind(globalThis), locationRef = globalThis.location, historyRef = globalThis.history, now = () => new Date(), navigatorRef = globalThis.navigator, storage } = {}) {
  initializeMapSheet({ documentRef });
  const period = initializeMapUrlControls({ documentRef, locationRef, historyRef, now });
  initializeArenaSearch({
    documentRef,
    fetchImpl: fetchImpl ?? globalThis.fetch?.bind(globalThis),
    locationRef,
    periodSelection: period,
  });
  const root = documentRef.querySelector('[data-map-page]');
  if (!root || root.dataset.mapPreview === 'true') return;
  if (!maplibre || !fetchImpl) return;
  if (root.dataset.dashboardMode === 'personal') {
    initializePersonalDashboard({
      documentRef, maplibre, fetchImpl, locationRef, navigatorRef, storage, periodSelection: period,
    });
  } else if (root.hasAttribute('data-competition-coverage')) {
    initializeCompetitionCoverage({ documentRef, maplibre, fetchImpl, locationRef, historyRef, now, navigatorRef, storage });
  }
}

if (typeof document !== 'undefined') initializeMapPage();
