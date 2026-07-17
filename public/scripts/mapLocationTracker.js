import { createMapButtonControl } from './mapButtonControl.js';
import { renderTrail, setCurrentPosition } from './mapTrailLayer.js';

export const MAXIMUM_LOCATION_ACCURACY_METERS = 100;

export function initializeMapLocationTracker({
  map,
  documentRef = document,
  geolocation,
  store,
  status = () => {},
}) {
  let watchId = null;
  let following = false;
  let lastPosition = null;
  let breakBeforeNextPoint = true;

  function updateLocationControl(label, pressed) {
    locationControl.setLabel(label);
    locationControl.setPressed(pressed);
  }

  function stopTracking(message = '') {
    if (watchId !== null) geolocation?.clearWatch?.(watchId);
    watchId = null;
    following = false;
    breakBeforeNextPoint = true;
    store.closeSegment();
    setCurrentPosition(map, null);
    updateLocationControl('Start location tracking', false);
    if (message) status(message);
  }

  function acceptPosition(position) {
    if (documentRef.hidden) return;
    const { longitude, latitude, accuracy } = position.coords;
    if (![longitude, latitude, accuracy].every(Number.isFinite)
      || accuracy > MAXIMUM_LOCATION_ACCURACY_METERS) return;
    if (breakBeforeNextPoint) store.startSegment();
    breakBeforeNextPoint = false;
    const point = { longitude, latitude, timestamp: position.timestamp };
    store.append(point);
    lastPosition = point;
    renderTrail(map, store.snapshot());
    setCurrentPosition(map, point);
    clearControl.setHidden(false);
    status('');
    if (following) map.easeTo({ center: [longitude, latitude], duration: 0 });
  }

  function startTracking() {
    if (!geolocation?.watchPosition) {
      status('Location tracking is not supported by this browser.');
      return;
    }
    status('');
    following = true;
    breakBeforeNextPoint = true;
    watchId = geolocation.watchPosition(
      acceptPosition,
      (error) => stopTracking(error?.code === 1
        ? 'Location permission was denied.'
        : 'Current location is unavailable.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    updateLocationControl('Stop location tracking', true);
  }

  function toggleLocation() {
    if (watchId === null) {
      startTracking();
      return;
    }
    if (!following) {
      following = true;
      updateLocationControl('Stop location tracking', true);
      if (lastPosition) {
        map.easeTo({ center: [lastPosition.longitude, lastPosition.latitude], duration: 0 });
      }
      return;
    }
    stopTracking();
  }

  function clearTrail() {
    const removed = store.clear();
    renderTrail(map, store.snapshot());
    clearControl.setHidden(removed);
    if (!removed) status('Unable to remove the saved trail from this browser.');
  }

  const locationControl = createMapButtonControl({
    documentRef,
    label: 'Start location tracking',
    symbol: '◎',
    onClick: toggleLocation,
  });
  const clearControl = createMapButtonControl({
    documentRef,
    label: 'Clear trail',
    symbol: '⌫',
    onClick: clearTrail,
  });
  clearControl.setHidden(!store.hasPoints());

  const onDragStart = () => {
    if (watchId === null) return;
    following = false;
    updateLocationControl('Resume following location', false);
  };
  const onVisibilityChange = () => {
    if (!documentRef.hidden || watchId === null) return;
    store.closeSegment();
    breakBeforeNextPoint = true;
  };
  map.on('dragstart', onDragStart);
  documentRef.addEventListener?.('visibilitychange', onVisibilityChange);

  return {
    locationControl,
    clearControl,
    toggleLocation,
    clearTrail,
    stopTracking,
    destroy() {
      stopTracking();
      map.off?.('dragstart', onDragStart);
      documentRef.removeEventListener?.('visibilitychange', onVisibilityChange);
    },
  };
}
