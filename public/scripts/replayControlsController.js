/** Shared replay controls and lifecycle for map and flight-detail replays. */
export function initializeReplayControls({ documentRef = document, root: providedRoot, onOpen, onClose } = {}) {
  const all = (selector) => {
    const nodes = documentRef.querySelectorAll?.(selector);
    if (nodes?.length) return [...nodes];
    const one = root?.querySelector?.(selector) ?? documentRef.querySelector?.(selector);
    return one ? [one] : [];
  };
  const root = providedRoot ?? documentRef.querySelector?.('[data-map-replay]');
  const entries = all('[data-map-replay-open]');
  const panels = all('[data-map-replay-panel]');
  const statuses = all('[data-map-replay-status]');
  const plays = all('[data-map-replay-play]');
  const playLabels = all('[data-map-replay-play-label]');
  const playIcons = all('[data-map-replay-play-icon]');
  const closes = all('[data-map-replay-close]');
  const sliders = all('[data-map-replay-slider]');
  const elapsedNodes = all('[data-map-replay-elapsed]');
  const speeds = all('[data-map-replay-speed]');
  const syncs = all('[data-map-replay-sync]');
  let timeline = null; let opened = false; let destroyed = false; let requestToken = 0;
  const format = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const setStatus = (text) => statuses.forEach((node) => { node.textContent = text; });
  const setEnabled = (enabled) => [...plays, ...sliders, ...speeds, ...syncs].forEach((node) => { node.disabled = !enabled; });
  const setPlayState = (playing) => { playLabels.forEach((n) => { n.textContent = playing ? 'Pause' : 'Play'; }); playIcons.forEach((n) => n.setAttribute('d', playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l11-7z')); };
  const setTimeline = (next) => {
    timeline?.destroy?.(); timeline = next ?? null;
    if (!timeline) return;
    timeline.subscribe((state) => {
      sliders.forEach((s) => { s.max = String(state.duration); s.value = String(state.elapsedMs); });
      elapsedNodes.forEach((e) => { e.textContent = `${format(state.elapsedMs)} / ${format(state.duration)}`; });
      if (Number.isFinite(state.rate)) {
        speeds.forEach((speed) => { speed.value = String(state.rate); });
      }
      syncs.forEach((sync) => { sync.setAttribute('aria-pressed', String(state.synchronized)); });
      setPlayState(state.playing);
    });
    setEnabled(true);
  };
  const close = () => {
    requestToken += 1; timeline?.destroy?.(); timeline = null; opened = false;
    panels.forEach((n) => { n.hidden = true; }); entries.forEach((n) => { n.hidden = false; n.setAttribute('aria-expanded', 'false'); });
    setEnabled(false); setPlayState(false); syncs.forEach((sync) => { sync.setAttribute('aria-pressed', 'true'); });
    onClose?.();
  };
  const open = async () => {
    if (destroyed || opened) return;
    opened = true; const token = ++requestToken;
    entries.forEach((n) => { n.hidden = true; n.setAttribute('aria-expanded', 'true'); }); panels.forEach((n) => { n.hidden = false; });
    setStatus('Loading replay…'); setEnabled(false);
    try { await onOpen?.({ setTimeline, setStatus, setEnabled, isCurrent: () => token === requestToken && opened }); }
    catch (error) { if (token === requestToken && opened) { console.error('Unable to open replay.', error); setStatus('Replay unavailable. Close and try again.'); } }
  };
  const onPlay = () => { if (!timeline) return; if (timeline.snapshot().playing) timeline.pause(); else timeline.play(); };
  const onSeek = (event) => timeline?.seek(Number(event?.currentTarget?.value ?? sliders[0]?.value));
  const onSpeed = (event) => timeline?.setRate(Number(event?.currentTarget?.value ?? speeds[0]?.value));
  const onSync = () => timeline?.setSynchronized?.(!timeline.snapshot().synchronized);
  entries.forEach((n) => n.addEventListener('click', open)); closes.forEach((n) => n.addEventListener('click', close)); plays.forEach((n) => n.addEventListener('click', onPlay)); sliders.forEach((n) => n.addEventListener('input', onSeek)); speeds.forEach((n) => n.addEventListener('change', onSpeed)); syncs.forEach((n) => n.addEventListener('click', onSync));
  setEnabled(false); entries.forEach((n) => n.setAttribute('aria-expanded', 'false'));
  return { open, close, setTimeline, setStatus, setEnabled, isOpen: () => opened, destroy() { if (destroyed) return; close(); destroyed = true; entries.forEach((n) => n.removeEventListener('click', open)); closes.forEach((n) => n.removeEventListener('click', close)); plays.forEach((n) => n.removeEventListener('click', onPlay)); sliders.forEach((n) => n.removeEventListener('input', onSeek)); speeds.forEach((n) => n.removeEventListener('change', onSpeed)); syncs.forEach((n) => n.removeEventListener('click', onSync)); } };
}
