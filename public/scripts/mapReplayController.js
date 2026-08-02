import { createMapReplayTimeline } from './mapReplayTimeline.js';
import { installMapReplayLayer } from './mapReplayLayer.js';
import { viewportSearchParams } from './viewportQuery.js';
import { initializeReplayControls } from './replayControlsController.js';

export function initializeMapReplayController({ documentRef = document, map, maplibre, fetchImpl = globalThis.fetch?.bind(globalThis), month, mode = 'personal', color = '#1769AA', colorForPilot, createTimeline = createMapReplayTimeline, installLayer = installMapReplayLayer } = {}) {
  const root = documentRef.querySelector('[data-map-replay]');
  if (!root || !['personal', 'competitive', 'following'].includes(mode) || !map || !fetchImpl) return null;
  const entries = [...(documentRef.querySelectorAll?.('[data-map-replay-open]') ?? root.querySelectorAll?.('[data-map-replay-open]') ?? [root.querySelector?.('[data-map-replay-open]')].filter(Boolean))];
  let selectedMonth = month ?? null; let layer = null;
  const controls = initializeReplayControls({ documentRef, root, onClose: () => { layer?.close?.(); layer = null; }, onOpen: async ({ setTimeline, setStatus, isCurrent }) => {
    const bounds = map.getBounds?.();
    if (!bounds) { setStatus('Replay unavailable.'); controls.close(); return; }
    const query = viewportSearchParams(bounds, { month: selectedMonth, mode });
    const response = await fetchImpl(`/v1/map-replay?${query}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
    const data = await response.json();
    if (!isCurrent()) return;
    if (!Array.isArray(data.flights) || data.flights.length === 0) { setStatus('No flights in this view for this month.'); return; }
    layer = installLayer(map, { colorForPilot: colorForPilot ?? (() => color), maplibre, documentRef });
    const timeline = createTimeline({ flights: data.flights });
    timeline.subscribe((state) => layer?.update(state));
    setTimeline(timeline); setStatus('');
  } });
  entries.forEach((node) => { node.hidden = !selectedMonth; });
  return { open: controls.open, close: controls.close, setMonth(nextMonth) { selectedMonth = nextMonth ?? null; controls.close(); entries.forEach((node) => { node.hidden = !selectedMonth; }); }, destroy() { controls.close(); controls.destroy(); } };
}
