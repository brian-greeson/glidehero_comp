import { createMapButtonControl } from './mapButtonControl.js';

export const MAP_REPLAY_FOLLOW_ZOOM = 12;
export const MAP_REPLAY_FOLLOW_LABEL = 'Stop following replay pilot';
export const MAP_REPLAY_RESUME_LABEL = 'Resume following replay pilot';
const MAP_REPLAY_CAMERA_EVENT_DATA = Object.freeze({ glideheroReplayCamera: true });

export function isMapReplayCameraMoveEvent(event) {
  return event?.glideheroReplayCamera === true;
}

function hasPilotCoordinate(flight) {
  return Array.isArray(flight?.marker)
    && flight.marker.length >= 2
    && flight.marker.every(Number.isFinite);
}

export function createMapReplayCamera(map, { zoom = MAP_REPLAY_FOLLOW_ZOOM, documentRef = globalThis.document } = {}) {
  let focused = false;
  let following = true;
  let followedFlightId = null;
  let lastCenter = null;

  const updateControl = () => {
    control?.setLabel(following ? MAP_REPLAY_FOLLOW_LABEL : MAP_REPLAY_RESUME_LABEL);
    control?.setPressed(following);
  };
  const toggleFollowing = () => {
    following = !following;
    updateControl();
    if (following && lastCenter) map.easeTo?.({ center: lastCenter, duration: 0 }, MAP_REPLAY_CAMERA_EVENT_DATA);
  };
  const control = documentRef?.createElement
    ? createMapButtonControl({ documentRef, label: MAP_REPLAY_FOLLOW_LABEL, symbol: '⌖', onClick: toggleFollowing })
    : null;
  const onDragStart = () => {
    if (!following) return;
    following = false;
    updateControl();
  };

  if (control) map.addControl?.(control, 'top-right');
  map.on?.('dragstart', onDragStart);
  updateControl();

  return {
    update(snapshot) {
      const flights = Array.isArray(snapshot?.flights) ? snapshot.flights : [];
      const followedFlight = flights.find((flight) => flight.flightId === followedFlightId);
      const target = (
        (hasPilotCoordinate(followedFlight) && !followedFlight.completed ? followedFlight : null)
        ?? flights.find((flight) => hasPilotCoordinate(flight) && !flight.completed)
        ?? (hasPilotCoordinate(followedFlight) ? followedFlight : null)
        ?? flights.find(hasPilotCoordinate)
      );
      if (!target) return;
      followedFlightId = target.flightId;
      lastCenter = target.marker;
      if (!following) return;
      map.easeTo?.({ center: lastCenter, ...(focused ? {} : { zoom }), duration: 0 }, MAP_REPLAY_CAMERA_EVENT_DATA);
      focused = true;
    },
    destroy() {
      map.off?.('dragstart', onDragStart);
      if (control) map.removeControl?.(control);
    },
  };
}
