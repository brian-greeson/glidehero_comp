import { initializeOnboarding } from './onboarding.js';
import { initializeArenaSearch } from './arenaSearch.js';
import { initializeCompetitionCoverage } from './competitionCoverageController.js';
import { initializeDashboardChrome } from './dashboardChrome.js';
import { initializeMobileSheet } from './mobileSheet.js';

export function initializeArena(options = {}) {
  const { documentRef = document, fetchImpl = window.fetch.bind(window) } = options;
  initializeOnboarding({ documentRef });
  initializeMobileSheet({ documentRef });
  initializeArenaSearch({ documentRef, fetchImpl });
  initializeDashboardChrome({ documentRef });
  return initializeCompetitionCoverage({ ...options, documentRef, fetchImpl });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-competition-coverage="arena"]')) initializeArena();
  }, { once: true });
}
