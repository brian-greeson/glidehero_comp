import { initializeOnboarding } from './onboarding.js';
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';

export async function loadPersonalTerritory(map, territoryColor, fetchImpl = fetch) {
  const response = await fetchImpl('/v1/personal-territory?type=grid', {
    credentials: 'same-origin',
    headers: { accept: 'application/geo+json' },
  });
  if (!response.ok) throw new Error(`Personal territory request failed with ${response.status}.`);

  const geojson = await response.json();
  map.addSource(PERSONAL_TERRITORY_SOURCE_ID, { type: 'geojson', data: geojson });
  map.addLayer(createTerritoryFillLayer({
    id: PERSONAL_TERRITORY_FILL_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    color: territoryColor,
  }));
  map.addLayer(createTerritoryBoundaryLayer({
    id: PERSONAL_TERRITORY_OUTLINE_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    color: territoryColor,
  }));
}

export function initializeDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
} = {}) {
  initializeOnboarding({ documentRef });

  const mapElement = documentRef.querySelector('[data-dashboard-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');

  function showMapUnavailable() {
    if (emptyState) {
      emptyState.textContent = 'Map unavailable. Check your connection and try again.';
      emptyState.hidden = false;
    }
  }

  function showTerritoryUnavailable() {
    if (emptyState) {
      emptyState.textContent = 'Unable to load your territory. Refresh the page.';
      emptyState.hidden = false;
    }
  }

  if (mapElement && maplibre) {
    try {
      const map = new maplibre.Map({
        container: mapElement,
        style: mapElement.dataset.mapStyleUrl,
        center: [-106.2, 39.2],
        zoom: 7,
      });
      map.addControl(new maplibre.NavigationControl(), 'top-right');
      map.once('error', showMapUnavailable);
      map.once('load', async () => {
        try {
          await loadPersonalTerritory(map, mapElement.dataset.territoryColor, fetchImpl);
        } catch {
          showTerritoryUnavailable();
        }
      });
    } catch {
      showMapUnavailable();
    }
  } else if (mapElement) {
    showMapUnavailable();
  }

  const currentMonth = documentRef.querySelector('[data-current-month]');
  if (currentMonth) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    currentMonth.textContent = `${formatter.format(start)} – ${formatter.format(end)} (Local)`;
  }

  const accountTrigger = documentRef.querySelector('[data-account-trigger]');
  const accountPopover = documentRef.querySelector('[data-account-popover]');
  if (accountTrigger && accountPopover) {
    accountTrigger.addEventListener('click', () => {
      const open = accountPopover.hidden;
      accountPopover.hidden = !open;
      accountTrigger.setAttribute('aria-expanded', String(open));
    });
  }

  const sheetToggle = documentRef.querySelector('[data-sheet-toggle]');
  const sheet = documentRef.querySelector('[data-mobile-sheet]');
  if (sheetToggle && sheet) {
    sheetToggle.addEventListener('click', () => {
      const expanded = sheet.classList.toggle('is-expanded');
      sheetToggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  const uploadForm = documentRef.querySelector('[data-upload-form]');
  const uploadInput = uploadForm?.querySelector('input[type="file"]');
  if (uploadForm && uploadInput) {
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files?.length) uploadForm.requestSubmit();
    });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => initializeDashboard(), { once: true });
}
