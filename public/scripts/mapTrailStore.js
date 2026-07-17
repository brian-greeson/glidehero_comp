export const MAP_TRAIL_STORAGE_KEY = 'glidehero.mapTrail.v1';
export const MAP_TRAIL_VERSION = 1;

function validPoint(point) {
  return point
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
    && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.timestamp);
}
function readValidPayload(storage) {
  try {
    const raw = storage?.getItem(MAP_TRAIL_STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const valid = payload?.version === MAP_TRAIL_VERSION
      && Array.isArray(payload.segments)
      && payload.segments.every((segment) => Array.isArray(segment)
        && segment.length > 0
        && segment.every(validPoint));
    if (valid) return payload.segments;
    storage?.removeItem(MAP_TRAIL_STORAGE_KEY);
  } catch {
    try { storage?.removeItem(MAP_TRAIL_STORAGE_KEY); } catch { /* Nothing else to recover. */ }
  }
  return [];
}

export function createMapTrailStore({
  storage = null,
  gapMilliseconds = 60_000,
  onPersistenceError = () => {},
} = {}) {
  let segments = readValidPayload(storage);
  let activeSegment = null;

  function persist() {
    try {
      if (!storage) throw new Error('Browser storage is unavailable.');
      storage.setItem(MAP_TRAIL_STORAGE_KEY, JSON.stringify({
        version: MAP_TRAIL_VERSION,
        segments,
      }));
    } catch (error) {
      onPersistenceError(error);
    }
  }

  return {
    snapshot: () => ({
      version: MAP_TRAIL_VERSION,
      segments: structuredClone(segments),
    }),
    hasPoints: () => segments.some((segment) => segment.length > 0),
    startSegment() {
      activeSegment = [];
      segments.push(activeSegment);
    },
    closeSegment() { activeSegment = null; },
    append(point) {
      const last = activeSegment?.at(-1) ?? segments.at(-1)?.at(-1);
      if (!activeSegment || (last && point.timestamp - last.timestamp > gapMilliseconds)) {
        activeSegment = [];
        segments.push(activeSegment);
      }
      activeSegment.push(point);
      persist();
    },
    clear() {
      segments = [];
      activeSegment = null;
      try {
        if (!storage) throw new Error('Browser storage is unavailable.');
        storage.removeItem(MAP_TRAIL_STORAGE_KEY);
        return true;
      } catch (error) {
        onPersistenceError(error);
        return false;
      }
    },
  };
}
