import { createMapButtonControl } from './mapButtonControl.js';
import { setCurrentPosition } from './mapPositionLayer.js';

export const MAXIMUM_LOCATION_ACCURACY_METERS = 100;

export function initializeMapLocationTracker({
  map,
  documentRef = document,
  geolocation,
  status = () => {},
}) {
  let watchId = null;
  let following = false;
  let lastPosition = null;

  function updateLocationControl(label, pressed) {
    locationControl.setLabel(label);
    locationControl.setPressed(pressed);
  }

  function stopTracking(message = '') {
    if (watchId !== null) geolocation?.clearWatch?.(watchId);
    watchId = null;
    following = false;
    setCurrentPosition(map, null);
    updateLocationControl('Start location tracking', false);
    if (message) status(message);
  }

  function acceptPosition(position) {
    if (documentRef.hidden) return;
    const { longitude, latitude, accuracy } = position.coords;
    if (![longitude, latitude, accuracy].every(Number.isFinite)
      || accuracy > MAXIMUM_LOCATION_ACCURACY_METERS) return;
    const point = { longitude, latitude };
    lastPosition = point;
    setCurrentPosition(map, point);
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

  const locationControl = createMapButtonControl({
    documentRef,
    label: 'Start location tracking',
    symbol: '◎',
    onClick: toggleLocation,
  });

  const onDragStart = () => {
    if (watchId === null) return;
    following = false;
    updateLocationControl('Resume following location', false);
  };
  map.on('dragstart', onDragStart);

  return {
    locationControl,
    toggleLocation,
    stopTracking,
    destroy() {
      stopTracking();
      map.off?.('dragstart', onDragStart);
    },
  };
}
