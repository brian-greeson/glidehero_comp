function clone(value) {
  return value.map((flight) => ({
    ...flight,
    points: flight.points.map((point) => [...point]),
  }));
}

function renderFlight(flight, elapsedMs, synchronized) {
  const points = flight.points;
  const flightElapsedMs = elapsedMs - (synchronized ? 0 : Math.max(0, flight.startOffsetMs ?? 0));
  if (flightElapsedMs < 0) return { flightId: flight.flightId, pilotUserId: flight.pilotUserId, track: [], marker: null, completed: false };
  if (points.length === 0) return { flightId: flight.flightId, pilotUserId: flight.pilotUserId, track: [], marker: null, completed: flightElapsedMs >= flight.durationMs };
  if (points.length === 1 || flightElapsedMs < points[0][2]) {
    const completed = points.length === 1 && flightElapsedMs >= flight.durationMs;
    return { flightId: flight.flightId, pilotUserId: flight.pilotUserId, track: points.length === 1 ? [[points[0][0], points[0][1]]] : [], marker: [...points[0].slice(0, 2)], completed };
  }
  let lo = 0; let hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid][2] <= flightElapsedMs) lo = mid + 1; else hi = mid; }
  const index = lo - 1;
  if (index >= points.length - 1) {
    return { flightId: flight.flightId, pilotUserId: flight.pilotUserId, track: points.map((p) => [...p.slice(0, 2)]), marker: [...points.at(-1).slice(0, 2)], completed: true };
  }
  const a = points[index]; const b = points[index + 1];
  const span = b[2] - a[2];
  const ratio = span > 0 ? Math.max(0, Math.min(1, (flightElapsedMs - a[2]) / span)) : 1;
  const marker = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
  const track = points.slice(0, index + 1).map((p) => [...p.slice(0, 2)]);
  track.push(marker);
  return { flightId: flight.flightId, pilotUserId: flight.pilotUserId, track, marker, completed: false };
}

export function createMapReplayTimeline({ flights = [], now = () => performance.now(), requestAnimationFrame = (callback) => globalThis.requestAnimationFrame(callback), cancelAnimationFrame = (id) => globalThis.cancelAnimationFrame(id) } = {}) {
  const sourceFlights = clone(flights);
  const calculateDuration = (synchronized) => sourceFlights.reduce((max, flight) => {
    const flightDuration = Number.isFinite(flight.durationMs) ? flight.durationMs : 0;
    const startOffset = !synchronized && Number.isFinite(flight.startOffsetMs) ? Math.max(0, flight.startOffsetMs) : 0;
    return Math.max(max, startOffset + flightDuration);
  }, 0);
  let synchronized = false; let duration = calculateDuration(synchronized);
  let elapsedMs = 0; let rate = 60; let playing = false; let finished = false; let frameId = null; let lastNow = 0;
  const listeners = new Set();
  const snapshot = () => ({ elapsedMs, duration, rate, playing, finished, synchronized, flights: sourceFlights.map((flight) => renderFlight(flight, elapsedMs, synchronized)) });
  const notify = () => { const state = snapshot(); listeners.forEach((listener) => listener(state)); };
  const tick = (time) => {
    if (!playing) return;
    elapsedMs = Math.min(duration, elapsedMs + Math.max(0, time - lastNow) * rate);
    lastNow = time;
    if (elapsedMs >= duration) { elapsedMs = duration; finished = true; playing = false; frameId = null; notify(); return; }
    notify(); frameId = requestAnimationFrame(tick);
  };
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    play() { if (playing) return; if (finished || elapsedMs >= duration) { elapsedMs = 0; finished = false; } playing = true; lastNow = now(); frameId = requestAnimationFrame(tick); notify(); },
    pause() { if (!playing) return; playing = false; if (frameId !== null) cancelAnimationFrame(frameId); frameId = null; notify(); },
    seek(value) { elapsedMs = Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0)); finished = elapsedMs >= duration; if (playing) lastNow = now(); notify(); },
    setRate(value) { if (Number.isFinite(value) && value > 0) { rate = value; notify(); } },
    setSynchronized(value) {
      const next = Boolean(value);
      if (next === synchronized) return;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null; playing = false; synchronized = next; duration = calculateDuration(synchronized); elapsedMs = 0; finished = false; notify();
    },
    destroy() { if (frameId !== null) cancelAnimationFrame(frameId); frameId = null; playing = false; listeners.clear(); },
  };
}
