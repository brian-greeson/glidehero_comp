import { createMapReplayTimeline } from './mapReplayTimeline.js';
import { installMapReplayLayer } from './mapReplayLayer.js';
import { viewportSearchParams } from './viewportQuery.js';

export function initializeMapReplayController({ documentRef = document, map, fetchImpl = globalThis.fetch?.bind(globalThis), month, mode = 'personal', color = '#1769AA', colorForPilot, createTimeline = createMapReplayTimeline, installLayer = installMapReplayLayer } = {}) {
  const root = documentRef.querySelector('[data-map-replay]');
  if (!root || !['personal', 'competitive', 'following'].includes(mode) || !map || !fetchImpl) return null;
  const all = (selector) => [...(documentRef.querySelectorAll?.(selector) ?? root.querySelectorAll?.(selector) ?? [root.querySelector?.(selector)].filter(Boolean))];
  const entries = all('[data-map-replay-open]'), panels = all('[data-map-replay-panel]'), statuses = all('[data-map-replay-status]'), plays = all('[data-map-replay-play]'), playLabels = all('[data-map-replay-play-label]'), playIcons = all('[data-map-replay-play-icon]'), skips = all('[data-map-replay-skip]'), closes = all('[data-map-replay-close]'), sliders = all('[data-map-replay-slider]'), elapsedNodes = all('[data-map-replay-elapsed]'), speeds = all('[data-map-replay-speed]');
  let timeline; let layer; let opened = false; let selectedMonth = month ?? null; let requestToken = 0;
  const format = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const setStatus = (text) => statuses.forEach((node) => { node.textContent = text; });
  const setControlsDisabled = (disabled) => [...plays, ...skips, ...sliders, ...speeds].forEach((node) => { node.disabled = disabled; });
  let destroyed = false;
  entries.forEach((node) => { node.hidden = !selectedMonth; node.setAttribute('aria-expanded', 'false'); });
  const setPlayState = (playing) => { playLabels.forEach((n) => { n.textContent = playing ? 'Pause' : 'Play'; }); playIcons.forEach((n) => n.setAttribute('d', playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l11-7z')); };
  const teardown = () => { requestToken += 1; timeline?.destroy(); timeline = null; layer?.close?.(); layer = null; panels.forEach((n) => { n.hidden = true; }); entries.forEach((n) => { n.hidden = !selectedMonth; n.setAttribute('aria-expanded', 'false'); }); setControlsDisabled(true); setPlayState(false); opened = false; };
  const open = async () => {
    if (destroyed || opened || !selectedMonth) return; opened = true; entries.forEach((n) => { n.hidden = true; n.setAttribute('aria-expanded', 'true'); }); panels.forEach((n) => { n.hidden = false; });
    setStatus('Loading replay…'); setControlsDisabled(true);
    const bounds = map.getBounds?.();
    if (!bounds) { setStatus('Replay unavailable.'); teardown(); return; }
    const query = viewportSearchParams(bounds, { month: selectedMonth, mode });
    const token = requestToken;
    try {
      const response = await fetchImpl(`/v1/map-replay?${query}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
      const data = await response.json();
      if (token !== requestToken || !opened) return;
      if (!Array.isArray(data.flights) || data.flights.length === 0) { setStatus('No flights in this view for this month.'); return; }
      layer = installLayer(map, { colorForPilot: colorForPilot ?? (() => color) });
      timeline = createTimeline({ flights: data.flights });
      timeline.subscribe((state) => { layer?.update(state); sliders.forEach((s) => { s.max = String(state.duration); s.value = String(state.elapsedMs); }); elapsedNodes.forEach((e) => { e.textContent = `${format(state.elapsedMs)} / ${format(state.duration)}`; }); setPlayState(state.playing); });
      setControlsDisabled(false); setStatus('Replay ready.');
    } catch (error) {
      if (token !== requestToken || !opened) return;
      console.error('Unable to open map replay.', error);
      setStatus('Replay unavailable. Close and try again.');
    }
  };
  const onPlay = () => { if (timeline?.snapshot().playing) timeline.pause(); else timeline?.play(); };
  const onSkip = (event) => { const state = timeline?.snapshot(); if (state) timeline.seek(state.elapsedMs + Number(event?.currentTarget?.dataset?.mapReplaySkip ?? 0)); };
  const onSeek = (event) => timeline?.seek(Number(event?.currentTarget?.value ?? sliders[0]?.value));
  const onSpeed = (event) => timeline?.setRate(Number(event?.currentTarget?.value ?? speeds[0]?.value));
  entries.forEach((n) => n.addEventListener('click', open)); closes.forEach((n) => n.addEventListener('click', teardown)); plays.forEach((n) => n.addEventListener('click', onPlay)); skips.forEach((n) => n.addEventListener('click', onSkip)); sliders.forEach((n) => n.addEventListener('input', onSeek)); speeds.forEach((n) => n.addEventListener('change', onSpeed));
  return { open, close: teardown, setMonth(nextMonth) { if (destroyed) return; selectedMonth = nextMonth ?? null; teardown(); }, destroy() { if (destroyed) return; teardown(); destroyed = true; entries.forEach((n) => n.removeEventListener('click', open)); closes.forEach((n) => n.removeEventListener('click', teardown)); plays.forEach((n) => n.removeEventListener('click', onPlay)); skips.forEach((n) => n.removeEventListener('click', onSkip)); sliders.forEach((n) => n.removeEventListener('input', onSeek)); speeds.forEach((n) => n.removeEventListener('change', onSpeed)); } };
}
