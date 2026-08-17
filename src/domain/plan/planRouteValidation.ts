import { routeDistanceMeters, type RoutePoint } from '../thermal/thermalRoute.js';

const MAXIMUM_LEG_DISTANCE_METERS = 1_000_000;
const MAXIMUM_PLAN_DISTANCE_METERS = 5_000_000;

function assertPoint(point: RoutePoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -85 || point.latitude > 85) {
    throw new RangeError('Plan latitude is invalid.');
  }
  if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    throw new RangeError('Plan longitude is invalid.');
  }
}

/** Validate planner turnpoints and return their total direct distance. */
export function validatePlanTurnpoints(turnpoints: readonly RoutePoint[]): number {
  if (turnpoints.length < 2 || turnpoints.length > 24) {
    throw new RangeError('A plan requires between 2 and 24 anchors.');
  }
  turnpoints.forEach(assertPoint);
  let totalDirectDistance = 0;
  for (let index = 1; index < turnpoints.length; index += 1) {
    const legDistance = routeDistanceMeters([turnpoints[index - 1]!, turnpoints[index]!]);
    if (legDistance < 1) throw new RangeError('Consecutive plan anchors must be distinct.');
    if (legDistance > MAXIMUM_LEG_DISTANCE_METERS) {
      throw new RangeError('Each planned leg must be 1,000 km or shorter.');
    }
    totalDirectDistance += legDistance;
  }
  if (totalDirectDistance > MAXIMUM_PLAN_DISTANCE_METERS) {
    throw new RangeError('The complete planned route must be 5,000 km or shorter.');
  }
  return totalDirectDistance;
}
