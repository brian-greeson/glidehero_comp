import { viewportSearchParams } from '../viewportQuery.js';

function periodValues(period) {
  if (period.period === 'all-time') return { period: 'all-time' };
  if (period.period === 'custom') return { period: 'custom', start: period.startDate, end: period.endDate };
  return { period: period.period, anchor: period.anchor };
}

export function personalHistoryRequestUrl(endpoint, { period, geography, bounds, launch }) {
  const values = {
    scope: 'personal',
    ...periodValues(period),
    geography: geography === 'map-area' ? 'map-area' : 'global',
    ...(launch ? { launch: String(launch) } : {}),
  };
  const query = geography === 'map-area' && bounds
    ? viewportSearchParams(bounds, values)
    : new URLSearchParams(values);
  return `${endpoint}?${query}`;
}

function distanceLabel(meters) {
  const value = Number(meters);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format((Number.isFinite(value) ? value : 0) / 1_000)} km`;
}

function airtimeLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function personalHistorySummaryLabels(summary) {
  return {
    totalFlights: new Intl.NumberFormat().format(Number(summary?.totalFlights) || 0),
    fivePointDistanceMeters: distanceLabel(summary?.fivePointDistanceMeters),
    airtimeSeconds: airtimeLabel(summary?.airtimeSeconds),
    launchesVisited: new Intl.NumberFormat().format(Number(summary?.launchesVisited) || 0),
    countriesVisited: new Intl.NumberFormat().format(Number(summary?.countriesVisited) || 0),
  };
}

export function initializePersonalHistory({ documentRef = document, fetchImpl = globalThis.fetch?.bind(globalThis), onLaunchChange } = {}) {
  const root = documentRef.querySelector?.('[data-personal-history]');
  if (!root || !fetchImpl) return null;
  const summaryEndpoint = root.dataset.summaryEndpoint;
  const launchesEndpoint = root.dataset.launchesEndpoint;
  const status = root.querySelector('[data-personal-history-status]');
  const launchSelect = documentRef.querySelector('[data-map-launch-filter]');
  let abort = null;

  const setStatus = (message) => { if (status) { status.textContent = message; status.hidden = !message; } };
  const renderSummary = (summary) => {
    const labels = personalHistorySummaryLabels(summary);
    for (const [key, value] of Object.entries(labels)) {
      const node = root.querySelector(`[data-personal-summary="${key}"]`);
      if (node) node.textContent = value;
    }
  };
  const renderLaunches = (payload, selected) => {
    if (!launchSelect) return;
    const prior = String(selected ?? '');
    const priorLabel = Array.from(launchSelect.options ?? []).find((option) => option.value === prior)?.textContent ?? '';
    launchSelect.replaceChildren();
    const all = documentRef.createElement('option'); all.value = ''; all.textContent = 'All launches'; launchSelect.append(all);
    for (const launch of payload?.launches ?? []) {
      const option = documentRef.createElement('option');
      option.value = String(launch.launchId); option.textContent = `${launch.name} (${launch.flightCount})`;
      launchSelect.append(option);
    }
    if (payload?.hasUnknown) { const option = documentRef.createElement('option'); option.value = 'unknown'; option.textContent = 'Unknown launch'; launchSelect.append(option); }
    if (prior && !Array.from(launchSelect.options ?? []).some((option) => option.value === prior)) {
      const option = documentRef.createElement('option'); option.value = prior;
      option.textContent = prior === 'unknown' ? 'Unknown launch' : (priorLabel || `Launch ${prior}`);
      launchSelect.append(option);
    }
    launchSelect.value = prior;
  };

  launchSelect?.addEventListener('change', () => onLaunchChange?.(launchSelect.value || null));

  return {
    async refresh(parameters) {
      abort?.abort(); abort = new AbortController();
      setStatus('Updating history…');
      const request = { ...parameters, launch: parameters.launch ?? null };
      try {
        const [summaryResponse, launchesResponse] = await Promise.all([
          fetchImpl(personalHistoryRequestUrl(summaryEndpoint, request), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: abort.signal }),
          fetchImpl(personalHistoryRequestUrl(launchesEndpoint, { ...request, launch: null }), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: abort.signal }),
        ]);
        if (!summaryResponse.ok || !launchesResponse.ok) throw new Error('Personal history request failed.');
        const [summary, launches] = await Promise.all([summaryResponse.json(), launchesResponse.json()]);
        renderSummary(summary); renderLaunches(launches, parameters.launch); setStatus('');
      } catch (error) {
        if (error?.name !== 'AbortError') setStatus('Unable to update personal history.');
      }
    },
    destroy() { abort?.abort(); },
  };
}
