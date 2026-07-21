import { initializeArenaSearch } from './arenaSearch.js';
import { initializeDashboardChrome } from './dashboardChrome.js';
import { initializeGlobalDashboard } from './globalDashboard.js';
import { initializeMobileSheet } from './mobileSheet.js';
import { initializeOnboarding } from './onboarding.js';
import { initializePersonalDashboard } from './personalDashboard.js';

export function initializeDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
  navigatorRef = globalThis.navigator,
  storage,
} = {}) {
  initializeOnboarding({ documentRef });
  initializeMobileSheet({ documentRef });
  initializeDashboardChrome({ documentRef });
  initializeArenaSearch({ documentRef, fetchImpl });

  const dashboardRoot = documentRef.querySelector('[data-dashboard]');
  if (dashboardRoot?.dataset.dashboardMode === 'global') {
    initializeGlobalDashboard({
      documentRef,
      maplibre,
      fetchImpl,
      locationRef,
      historyRef,
      now,
      navigatorRef,
      storage,
    });
    return;
  }

  initializePersonalDashboard({ documentRef, maplibre, fetchImpl, navigatorRef, storage });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-dashboard]')) initializeDashboard();
  }, { once: true });
}
