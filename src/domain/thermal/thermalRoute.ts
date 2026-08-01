export type RoutePoint = { latitude: number; longitude: number };
export type ThermalRouteCandidate = RoutePoint & { relativeScore: number; areaSquareMeters: number };

const EARTH_RADIUS_METERS = 6_371_008.8;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function routeDistanceMeters(points: readonly RoutePoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const latitudeDelta = radians(to.latitude - from.latitude);
    const longitudeDelta = radians(to.longitude - from.longitude);
    const latitude1 = radians(from.latitude);
    const latitude2 = radians(to.latitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
    distance += 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return distance;
}

function bearing(from: RoutePoint, to: RoutePoint): number {
  const y = Math.sin(radians(to.longitude - from.longitude)) * Math.cos(radians(to.latitude));
  const x = Math.cos(radians(from.latitude)) * Math.sin(radians(to.latitude))
    - Math.sin(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.cos(radians(to.longitude - from.longitude));
  return Math.atan2(y, x);
}

function headingChange(from: RoutePoint, via: RoutePoint, to: RoutePoint): number {
  const incoming = bearing(from, via);
  const outgoing = bearing(via, to);
  let delta = Math.abs(outgoing - incoming);
  if (delta > Math.PI) delta = (2 * Math.PI) - delta;
  return delta;
}

/** Insert favorable lift centers while preserving a strict per-leg distance ceiling. */
export function thermalGuidedLeg(input: {
  start: RoutePoint;
  end: RoutePoint;
  maximumDeviationPercent: number;
  candidates: readonly ThermalRouteCandidate[];
  maximumInsertedPoints?: number;
}): { points: RoutePoint[]; directDistanceMeters: number; maximumDistanceMeters: number; routeDistanceMeters: number } {
  const directDistanceMeters = routeDistanceMeters([input.start, input.end]);
  const maximumDistanceMeters = directDistanceMeters * (1 + input.maximumDeviationPercent / 100);
  const points: RoutePoint[] = [input.start, input.end];
  if (input.maximumDeviationPercent <= 0 || directDistanceMeters === 0) {
    return { points, directDistanceMeters, maximumDistanceMeters: directDistanceMeters, routeDistanceMeters: directDistanceMeters };
  }
  const remaining = [...input.candidates];
  const maximumInsertedPoints = input.maximumInsertedPoints ?? 6;
  for (let inserted = 0; inserted < maximumInsertedPoints && remaining.length; inserted += 1) {
    const currentDistance = routeDistanceMeters(points);
    let best: { candidateIndex: number; insertionIndex: number; value: number; nextDistance: number } | null = null;
    for (let candidateIndex = 0; candidateIndex < remaining.length; candidateIndex += 1) {
      const candidate = remaining[candidateIndex]!;
      if (points.some((point) => routeDistanceMeters([point, candidate]) < 1)) continue;
      for (let insertionIndex = 1; insertionIndex < points.length; insertionIndex += 1) {
        const from = points[insertionIndex - 1]!;
        const to = points[insertionIndex]!;
        const oldSegment = routeDistanceMeters([from, to]);
        const newSegment = routeDistanceMeters([from, candidate, to]);
        const nextDistance = currentDistance - oldSegment + newSegment;
        if (nextDistance > maximumDistanceMeters) continue;
        const extraDistance = Math.max(0, newSegment - oldSegment);
        const turnPenalty = headingChange(from, candidate, to) * 450;
        const areaReward = Math.min(1_500, Math.sqrt(Math.max(0, candidate.areaSquareMeters)) * 3);
        const thermalReward = candidate.relativeScore * 3_000 + areaReward;
        const value = thermalReward - extraDistance - turnPenalty;
        if (value > 0 && (!best || value > best.value)) best = { candidateIndex, insertionIndex, value, nextDistance };
      }
    }
    if (!best) break;
    points.splice(best.insertionIndex, 0, remaining[best.candidateIndex]!);
    remaining.splice(best.candidateIndex, 1);
  }
  return {
    points,
    directDistanceMeters,
    maximumDistanceMeters,
    routeDistanceMeters: routeDistanceMeters(points),
  };
}
