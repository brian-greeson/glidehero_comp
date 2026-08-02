export type RoutePoint = { latitude: number; longitude: number };

export type RoutingPriority = 'shorter' | 'balanced' | 'thermal';

export type ThermalRouteSample = RoutePoint & {
  sampleIndex: number;
  layerIndex: number;
  progressMeters: number;
  lateralOffsetMeters: number;
};

export type ThermalRoutingField = {
  start: RoutePoint;
  end: RoutePoint;
  directDistanceMeters: number;
  maximumDistanceMeters: number;
  extraDistancePenalty: number;
  sampleSpacingMeters: number;
  layers: ThermalRouteSample[][];
  samples: ThermalRouteSample[];
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const TARGET_SAMPLE_SPACING_METERS = 200;
const MAXIMUM_PLAN_PROGRESS_SEGMENTS = 500;
const MINIMUM_PROGRESS_LAYERS = 8;
const MAXIMUM_PROGRESS_LAYERS = 500;
const MAXIMUM_LATERAL_COLUMNS_PER_SIDE = 15;
const MAXIMUM_SEARCH_HEADING_CHANGE_RADIANS = (65 * Math.PI) / 180;
const MAXIMUM_OUTPUT_HEADING_CHANGE_RADIANS = (75 * Math.PI) / 180;
const CORNER_CUT_THRESHOLD_RADIANS = (35 * Math.PI) / 180;
const HEADING_BIN_RADIANS = (5 * Math.PI) / 180;

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

function normalizeAngle(value: number): number {
  let result = value;
  while (result > Math.PI) result -= 2 * Math.PI;
  while (result < -Math.PI) result += 2 * Math.PI;
  return result;
}

function interpolate(from: RoutePoint, to: RoutePoint, ratio: number): RoutePoint {
  return {
    latitude: from.latitude + ((to.latitude - from.latitude) * ratio),
    longitude: from.longitude + ((to.longitude - from.longitude) * ratio),
  };
}

type RouteFrame = {
  metersPerLatitudeDegree: number;
  metersPerLongitudeDegree: number;
  unitEast: number;
  unitNorth: number;
  localDirectDistanceMeters: number;
};

function routeFrame(start: RoutePoint, end: RoutePoint): RouteFrame {
  const middleLatitude = (start.latitude + end.latitude) / 2;
  const metersPerLatitudeDegree = 111_132;
  const metersPerLongitudeDegree = Math.max(1, 111_320 * Math.cos(radians(middleLatitude)));
  const east = (end.longitude - start.longitude) * metersPerLongitudeDegree;
  const north = (end.latitude - start.latitude) * metersPerLatitudeDegree;
  const localDirectDistanceMeters = Math.hypot(east, north);
  return {
    metersPerLatitudeDegree,
    metersPerLongitudeDegree,
    unitEast: localDirectDistanceMeters > 0 ? east / localDirectDistanceMeters : 1,
    unitNorth: localDirectDistanceMeters > 0 ? north / localDirectDistanceMeters : 0,
    localDirectDistanceMeters,
  };
}

function pointAt(start: RoutePoint, frame: RouteFrame, progressRatio: number, lateralOffsetMeters: number): RoutePoint {
  const progress = frame.localDirectDistanceMeters * progressRatio;
  const east = (frame.unitEast * progress) - (frame.unitNorth * lateralOffsetMeters);
  const north = (frame.unitNorth * progress) + (frame.unitEast * lateralOffsetMeters);
  return {
    latitude: start.latitude + (north / frame.metersPerLatitudeDegree),
    longitude: start.longitude + (east / frame.metersPerLongitudeDegree),
  };
}

/** Build a bounded, adaptive field that the service can score against PostGIS thermal areas. */
export function createThermalRoutingField(input: {
  start: RoutePoint;
  end: RoutePoint;
  routingPriority: RoutingPriority;
  targetSampleSpacingMeters?: number;
}): ThermalRoutingField {
  const directDistanceMeters = routeDistanceMeters([input.start, input.end]);
  const priority = {
    shorter: { maximumExtraDistanceRatio: 0.1, extraDistancePenalty: 0.5 },
    balanced: { maximumExtraDistanceRatio: 0.25, extraDistancePenalty: 0.25 },
    thermal: { maximumExtraDistanceRatio: 0.5, extraDistancePenalty: 0.1 },
  }[input.routingPriority];
  const maximumDistanceMeters = directDistanceMeters * (1 + priority.maximumExtraDistanceRatio);
  const progressSegments = Math.max(
    MINIMUM_PROGRESS_LAYERS,
    Math.min(MAXIMUM_PROGRESS_LAYERS, Math.ceil(directDistanceMeters / (input.targetSampleSpacingMeters ?? TARGET_SAMPLE_SPACING_METERS))),
  );
  const progressSpacingMeters = directDistanceMeters / progressSegments;
  const semiMajor = maximumDistanceMeters / 2;
  const focalDistance = directDistanceMeters / 2;
  const maximumLateralOffset = Math.sqrt(Math.max(0, (semiMajor ** 2) - (focalDistance ** 2)));
  const lateralSpacingMeters = maximumLateralOffset > 0
    ? Math.max(
      progressSpacingMeters,
      Math.min(
        maximumLateralOffset / MAXIMUM_LATERAL_COLUMNS_PER_SIDE,
        progressSpacingMeters * Math.tan(MAXIMUM_SEARCH_HEADING_CHANGE_RADIANS) * 0.9,
      ),
    )
    : progressSpacingMeters;
  const frame = routeFrame(input.start, input.end);
  const layers: ThermalRouteSample[][] = [];
  const samples: ThermalRouteSample[] = [];

  for (let layerIndex = 0; layerIndex <= progressSegments; layerIndex += 1) {
    const progressRatio = layerIndex / progressSegments;
    const progressMeters = directDistanceMeters * progressRatio;
    let offsets = [0];
    if (layerIndex > 0 && layerIndex < progressSegments && maximumLateralOffset > 0) {
      const centeredProgress = progressMeters - focalDistance;
      const ellipseRatio = semiMajor > 0 ? centeredProgress / semiMajor : 0;
      const availableLateralOffset = maximumLateralOffset * Math.sqrt(Math.max(0, 1 - (ellipseRatio ** 2)));
      const columns = Math.min(MAXIMUM_LATERAL_COLUMNS_PER_SIDE, Math.floor(availableLateralOffset / lateralSpacingMeters));
      offsets = Array.from({ length: (columns * 2) + 1 }, (_, index) => (index - columns) * lateralSpacingMeters);
    }
    const layer = offsets.map((lateralOffsetMeters) => {
      const point = layerIndex === 0
        ? input.start
        : layerIndex === progressSegments
          ? input.end
          : pointAt(input.start, frame, progressRatio, lateralOffsetMeters);
      const sample: ThermalRouteSample = {
        ...point,
        sampleIndex: samples.length,
        layerIndex,
        progressMeters,
        lateralOffsetMeters,
      };
      samples.push(sample);
      return sample;
    });
    layers.push(layer);
  }

  return {
    start: input.start,
    end: input.end,
    directDistanceMeters,
    maximumDistanceMeters,
    extraDistancePenalty: priority.extraDistancePenalty,
    sampleSpacingMeters: progressSpacingMeters,
    layers,
    samples,
  };
}

/** Preserve 200 m resolution through 100 km while bounding total progress layers for longer multi-leg plans. */
export function planSampleSpacingMeters(totalDirectDistanceMeters: number): number {
  return Math.max(TARGET_SAMPLE_SPACING_METERS, totalDirectDistanceMeters / MAXIMUM_PLAN_PROGRESS_SEGMENTS);
}

type SearchState = {
  node: ThermalRouteSample;
  path: ThermalRouteSample[];
  distanceMeters: number;
  thermalMeters: number;
  headingRadians: number;
  turnBurden: number;
  bendCount: number;
  reversalCount: number;
  lastLateralTravelSign: number;
};

function compareStates(
  left: SearchState,
  right: SearchState,
  thermalClosenessMeters: number,
  extraDistancePenalty: number,
): number {
  // One corridor may require an approach, a traverse, and an exit. More than
  // two lateral travel reversals is a zigzag, not a tradeable thermal benefit.
  const leftZigzagExcess = Math.max(0, left.reversalCount - 2);
  const rightZigzagExcess = Math.max(0, right.reversalCount - 2);
  if (leftZigzagExcess !== rightZigzagExcess) return leftZigzagExcess - rightZigzagExcess;
  const leftEfficientThermal = left.thermalMeters
    - (Math.max(0, left.distanceMeters - left.node.progressMeters) * extraDistancePenalty);
  const rightEfficientThermal = right.thermalMeters
    - (Math.max(0, right.distanceMeters - right.node.progressMeters) * extraDistancePenalty);
  const thermalDifference = rightEfficientThermal - leftEfficientThermal;
  if (Math.abs(thermalDifference) > thermalClosenessMeters) return thermalDifference;
  if (left.bendCount !== right.bendCount) return left.bendCount - right.bendCount;
  if (left.turnBurden !== right.turnBurden) return left.turnBurden - right.turnBurden;
  if (left.distanceMeters !== right.distanceMeters) return left.distanceMeters - right.distanceMeters;
  return left.path.map((point) => point.sampleIndex).join(',').localeCompare(right.path.map((point) => point.sampleIndex).join(','));
}

function retainHeadingDiversity(
  candidates: SearchState[],
  thermalClosenessMeters: number,
  extraDistancePenalty: number,
): SearchState[] {
  const bins = new Map<number, SearchState[]>();
  for (const candidate of candidates) {
    const bin = Math.round(candidate.headingRadians / HEADING_BIN_RADIANS);
    const existing = bins.get(bin) ?? [];
    existing.push(candidate);
    bins.set(bin, existing);
  }
  const retained: SearchState[] = [];
  for (const states of bins.values()) {
    states.sort((left, right) => compareStates(left, right, thermalClosenessMeters, extraDistancePenalty));
    retained.push(states[0]!);
    const shortest = [...states].sort((left, right) => left.distanceMeters - right.distanceMeters)[0]!;
    if (shortest !== states[0]) retained.push(shortest);
    const strongestThermal = [...states].sort((left, right) => {
      const thermalDifference = right.thermalMeters - left.thermalMeters;
      if (Math.abs(thermalDifference) > thermalClosenessMeters) return thermalDifference;
      return (left.distanceMeters - right.distanceMeters)
        || (left.reversalCount - right.reversalCount)
        || (left.turnBurden - right.turnBurden);
    })[0]!;
    if (strongestThermal !== states[0] && strongestThermal !== shortest) retained.push(strongestThermal);
  }
  return retained;
}

function sampleScore(scores: ReadonlyMap<number, number>, sampleIndex: number): number {
  return Math.max(0, Math.min(1, scores.get(sampleIndex) ?? 0));
}

function lateralSampleScore(
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
  layerIndex: number,
  lateralOffsetMeters: number,
): number {
  const sample = field.layers[layerIndex]!.reduce((closest, candidate) => (
    Math.abs(candidate.lateralOffsetMeters - lateralOffsetMeters) < Math.abs(closest.lateralOffsetMeters - lateralOffsetMeters)
      ? candidate
      : closest
  ));
  return sampleScore(scores, sample.sampleIndex);
}

function edgeThermalDistanceMeters(
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
  from: ThermalRouteSample,
  to: ThermalRouteSample,
  distanceMeters: number,
): number {
  const fractions = [0.125, 0.375, 0.625, 0.875];
  const averageScore = fractions.reduce((total, fraction) => {
    const layerIndex = fraction < 0.5 ? from.layerIndex : to.layerIndex;
    const lateralOffset = from.lateralOffsetMeters
      + ((to.lateralOffsetMeters - from.lateralOffsetMeters) * fraction);
    return total + lateralSampleScore(field, scores, layerIndex, lateralOffset);
  }, 0) / fractions.length;
  return distanceMeters * averageScore;
}

function closestSample(field: ThermalRoutingField, point: RoutePoint): ThermalRouteSample {
  const frame = routeFrame(field.start, field.end);
  const east = (point.longitude - field.start.longitude) * frame.metersPerLongitudeDegree;
  const north = (point.latitude - field.start.latitude) * frame.metersPerLatitudeDegree;
  const localProgress = (east * frame.unitEast) + (north * frame.unitNorth);
  const lateralOffset = (-east * frame.unitNorth) + (north * frame.unitEast);
  const layerIndex = Math.max(0, Math.min(
    field.layers.length - 1,
    Math.round((localProgress / Math.max(1, frame.localDirectDistanceMeters)) * (field.layers.length - 1)),
  ));
  return field.layers[layerIndex]!.reduce((closest, sample) => (
    Math.abs(sample.lateralOffsetMeters - lateralOffset) < Math.abs(closest.lateralOffsetMeters - lateralOffset) ? sample : closest
  ));
}

export function weightedThermalDistanceMeters(
  points: readonly RoutePoint[],
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
): number {
  let weightedDistance = 0;
  const scoringStep = Math.max(50, field.sampleSpacingMeters / 2);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const distance = routeDistanceMeters([from, to]);
    const steps = Math.max(1, Math.ceil(distance / scoringStep));
    for (let step = 0; step < steps; step += 1) {
      const first = interpolate(from, to, step / steps);
      const second = interpolate(from, to, (step + 1) / steps);
      const middle = interpolate(first, second, 0.5);
      weightedDistance += routeDistanceMeters([first, second]) * sampleScore(scores, closestSample(field, middle).sampleIndex);
    }
  }
  return weightedDistance;
}

function routeHeadings(points: readonly RoutePoint[], field: ThermalRoutingField): number[] {
  const frame = routeFrame(field.start, field.end);
  return points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const east = (point.longitude - previous.longitude) * frame.metersPerLongitudeDegree;
    const north = (point.latitude - previous.latitude) * frame.metersPerLatitudeDegree;
    const progress = (east * frame.unitEast) + (north * frame.unitNorth);
    const lateral = (-east * frame.unitNorth) + (north * frame.unitEast);
    return Math.atan2(lateral, progress);
  });
}

function isForwardSmoothRoute(points: readonly RoutePoint[], field: ThermalRoutingField): boolean {
  const frame = routeFrame(field.start, field.end);
  let previousProgress = -Infinity;
  for (const point of points) {
    const east = (point.longitude - field.start.longitude) * frame.metersPerLongitudeDegree;
    const north = (point.latitude - field.start.latitude) * frame.metersPerLatitudeDegree;
    const progress = (east * frame.unitEast) + (north * frame.unitNorth);
    if (progress <= previousProgress + 0.01) return false;
    previousProgress = progress;
  }
  const headings = routeHeadings(points, field);
  for (let index = 1; index < headings.length; index += 1) {
    if (Math.abs(normalizeAngle(headings[index]! - headings[index - 1]!)) > MAXIMUM_OUTPUT_HEADING_CHANGE_RADIANS) return false;
  }
  return true;
}

function simplifyRoute(
  input: RoutePoint[],
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
  minimumThermalMeters: number,
): RoutePoint[] {
  let points = [...input];
  while (points.length > 2) {
    let best: { index: number; thermalMeters: number; distanceMeters: number } | null = null;
    for (let index = 1; index < points.length - 1; index += 1) {
      const trial = points.filter((_, pointIndex) => pointIndex !== index);
      const distanceMeters = routeDistanceMeters(trial);
      if (distanceMeters > field.maximumDistanceMeters + 0.01 || !isForwardSmoothRoute(trial, field)) continue;
      const thermalMeters = weightedThermalDistanceMeters(trial, field, scores);
      if (thermalMeters + 0.01 < minimumThermalMeters) continue;
      if (!best || thermalMeters > best.thermalMeters
        || (thermalMeters === best.thermalMeters && distanceMeters < best.distanceMeters)) {
        best = { index, thermalMeters, distanceMeters };
      }
    }
    if (!best) break;
    points.splice(best.index, 1);
  }
  return points;
}

function cutCorners(
  input: RoutePoint[],
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
  minimumThermalMeters: number,
): RoutePoint[] {
  let points = [...input];
  // Round only the sharpest corner on each pass. This avoids turning a simple
  // enter-follow-exit corridor into a staircase while still giving a hard
  // transition enough room to become a few short, flyable straight segments.
  while (points.length < 8) {
    const headings = routeHeadings(points, field);
    let sharpest: { index: number; change: number } | null = null;
    for (let index = 1; index < points.length - 1; index += 1) {
      const change = Math.abs(normalizeAngle(headings[index]! - headings[index - 1]!));
      if (change >= CORNER_CUT_THRESHOLD_RADIANS && (!sharpest || change > sharpest.change)) {
        sharpest = { index, change };
      }
    }
    if (!sharpest) break;
    const index = sharpest.index;
    const before = interpolate(points[index - 1]!, points[index]!, 0.55);
    const after = interpolate(points[index]!, points[index + 1]!, 0.45);
    const trial = [...points.slice(0, index), before, after, ...points.slice(index + 1)];
    if (routeDistanceMeters(trial) > field.maximumDistanceMeters + 0.01) break;
    if (weightedThermalDistanceMeters(trial, field, scores) + 0.01 < minimumThermalMeters) break;
    points = trial;
    if (isForwardSmoothRoute(points, field)) break;
  }
  return points;
}

function simplifyCenterline(points: RoutePoint[], field: ThermalRoutingField): RoutePoint[] {
  if (points.length <= 2) return points;
  const frame = routeFrame(field.start, field.end);
  const local = (point: RoutePoint): { x: number; y: number } => ({
    x: (point.longitude - field.start.longitude) * frame.metersPerLongitudeDegree,
    y: (point.latitude - field.start.latitude) * frame.metersPerLatitudeDegree,
  });
  const toleranceMeters = Math.max(300, field.sampleSpacingMeters * 3);
  const simplify = (input: RoutePoint[]): RoutePoint[] => {
    if (input.length <= 2) return input;
    const from = local(input[0]!);
    const to = local(input.at(-1)!);
    const segmentX = to.x - from.x;
    const segmentY = to.y - from.y;
    const segmentLengthSquared = (segmentX ** 2) + (segmentY ** 2);
    let farthestIndex = -1;
    let farthestDistance = 0;
    for (let index = 1; index < input.length - 1; index += 1) {
      const point = local(input[index]!);
      const ratio = segmentLengthSquared > 0
        ? Math.max(0, Math.min(1, (((point.x - from.x) * segmentX) + ((point.y - from.y) * segmentY)) / segmentLengthSquared))
        : 0;
      const distance = Math.hypot(point.x - (from.x + (segmentX * ratio)), point.y - (from.y + (segmentY * ratio)));
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex < 0 || farthestDistance <= toleranceMeters) return [input[0]!, input.at(-1)!];
    const left = simplify(input.slice(0, farthestIndex + 1));
    const right = simplify(input.slice(farthestIndex));
    return [...left.slice(0, -1), ...right];
  };
  return simplify(points);
}

function corridorRouteCandidates(
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
): RoutePoint[][] {
  const active = field.samples
    .filter((sample) => sampleScore(scores, sample.sampleIndex) > 0)
    .sort((left, right) => left.progressMeters - right.progressMeters || left.lateralOffsetMeters - right.lateralOffsetMeters);
  if (active.length < 2) return [];
  const parent = active.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const maximumGapMeters = Math.max(800, field.sampleSpacingMeters * 5.1);
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const progressGap = active[right]!.progressMeters - active[left]!.progressMeters;
      if (progressGap > maximumGapMeters) break;
      const lateralGap = Math.abs(active[right]!.lateralOffsetMeters - active[left]!.lateralOffsetMeters);
      const maximumLateralGap = Math.max(field.sampleSpacingMeters * 2, progressGap * 0.75);
      if (lateralGap <= maximumLateralGap) union(left, right);
    }
  }

  const components = new Map<number, ThermalRouteSample[]>();
  active.forEach((sample, index) => {
    const root = find(index);
    const component = components.get(root) ?? [];
    component.push(sample);
    components.set(root, component);
  });

  const routes: RoutePoint[][] = [];
  for (const component of components.values()) {
    const progressSpan = component.at(-1)!.progressMeters - component[0]!.progressMeters;
    if (component.length < 3 || progressSpan < Math.max(400, field.sampleSpacingMeters * 2)) continue;
    const byLayer = new Map<number, ThermalRouteSample[]>();
    for (const sample of component) {
      const layer = byLayer.get(sample.layerIndex) ?? [];
      layer.push(sample);
      byLayer.set(sample.layerIndex, layer);
    }
    const centerline = [...byLayer.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, layer]) => {
        const totalWeight = layer.reduce((total, sample) => total + sampleScore(scores, sample.sampleIndex), 0);
        return {
          latitude: layer.reduce((total, sample) => total + (sample.latitude * sampleScore(scores, sample.sampleIndex)), 0) / totalWeight,
          longitude: layer.reduce((total, sample) => total + (sample.longitude * sampleScore(scores, sample.sampleIndex)), 0) / totalWeight,
        };
      });
    routes.push([field.start, ...simplifyCenterline(centerline, field), field.end]);
  }
  return routes;
}

function finalizedRoute(
  rawPoints: RoutePoint[],
  field: ThermalRoutingField,
  scores: ReadonlyMap<number, number>,
  directThermalMeters: number,
): { points: RoutePoint[]; thermalMeters: number; distanceMeters: number } | null {
  const rawThermalMeters = weightedThermalDistanceMeters(rawPoints, field, scores);
  const rawDistanceMeters = routeDistanceMeters(rawPoints);
  const extraDistanceMeters = Math.max(0, rawDistanceMeters - field.directDistanceMeters);
  const meaningfulImprovementMeters = Math.max(
    75,
    field.directDistanceMeters * 0.01,
    extraDistanceMeters * field.extraDistancePenalty,
  );
  if (rawThermalMeters < directThermalMeters + meaningfulImprovementMeters) return null;
  const minimumThermalMeters = rawThermalMeters - Math.max(100, rawThermalMeters * 0.15);
  const simplified = simplifyRoute(rawPoints, field, scores, minimumThermalMeters);
  const roundedThermalFloor = Math.max(
    directThermalMeters + meaningfulImprovementMeters,
    rawThermalMeters - Math.max(200, rawThermalMeters * 0.5),
  );
  const rounded = cutCorners(simplified, field, scores, roundedThermalFloor);
  const distanceMeters = routeDistanceMeters(rounded);
  if (distanceMeters > field.maximumDistanceMeters + 0.01 || !isForwardSmoothRoute(rounded, field)) return null;
  return {
    points: rounded,
    thermalMeters: weightedThermalDistanceMeters(rounded, field, scores),
    distanceMeters,
  };
}

/** Find a simple forward route through favorable lift without exceeding the strict per-leg distance ceiling. */
export function thermalGuidedLeg(input: {
  field: ThermalRoutingField;
  relativeScores: ReadonlyMap<number, number>;
}): { points: RoutePoint[]; directDistanceMeters: number; maximumDistanceMeters: number; routeDistanceMeters: number } {
  const { field } = input;
  const directPoints = [field.start, field.end];
  if (field.maximumDistanceMeters <= field.directDistanceMeters || field.layers.length <= 2) {
    return {
      points: directPoints,
      directDistanceMeters: field.directDistanceMeters,
      maximumDistanceMeters: field.directDistanceMeters,
      routeDistanceMeters: field.directDistanceMeters,
    };
  }

  if (![...input.relativeScores.values()].some((score) => score > 0)) {
    return {
      points: directPoints,
      directDistanceMeters: field.directDistanceMeters,
      maximumDistanceMeters: field.maximumDistanceMeters,
      routeDistanceMeters: field.directDistanceMeters,
    };
  }

  const directThermalMeters = weightedThermalDistanceMeters(directPoints, field, input.relativeScores);
  const corridorRoutes = corridorRouteCandidates(field, input.relativeScores)
    .map((points) => finalizedRoute(points, field, input.relativeScores, directThermalMeters))
    .filter((route): route is NonNullable<typeof route> => route !== null)
    .sort((left, right) => {
      const leftUtility = left.thermalMeters
        - (Math.max(0, left.distanceMeters - field.directDistanceMeters) * field.extraDistancePenalty);
      const rightUtility = right.thermalMeters
        - (Math.max(0, right.distanceMeters - field.directDistanceMeters) * field.extraDistancePenalty);
      if (Math.abs(rightUtility - leftUtility) > Math.max(40, field.directDistanceMeters * 0.005)) return rightUtility - leftUtility;
      if (left.points.length !== right.points.length) return left.points.length - right.points.length;
      return left.distanceMeters - right.distanceMeters;
    });
  if (corridorRoutes[0]) {
    return {
      points: corridorRoutes[0].points,
      directDistanceMeters: field.directDistanceMeters,
      maximumDistanceMeters: field.maximumDistanceMeters,
      routeDistanceMeters: corridorRoutes[0].distanceMeters,
    };
  }

  const first = field.layers[0]![0]!;
  let states: SearchState[] = [{
    node: first,
    path: [first],
    distanceMeters: 0,
    thermalMeters: 0,
    headingRadians: 0,
    turnBurden: 0,
    bendCount: 0,
    reversalCount: 0,
    lastLateralTravelSign: 0,
  }];
  const thermalClosenessMeters = Math.max(40, field.directDistanceMeters * 0.005);

  for (let layerIndex = 1; layerIndex < field.layers.length; layerIndex += 1) {
    const nextStates: SearchState[] = [];
    for (const node of field.layers[layerIndex]!) {
      const candidates: SearchState[] = [];
      for (const state of states) {
        const progressDelta = node.progressMeters - state.node.progressMeters;
        if (progressDelta <= 0) continue;
        const lateralDelta = node.lateralOffsetMeters - state.node.lateralOffsetMeters;
        const headingRadians = Math.atan2(lateralDelta, progressDelta);
        const headingChange = normalizeAngle(headingRadians - state.headingRadians);
        if (Math.abs(headingChange) > MAXIMUM_SEARCH_HEADING_CHANGE_RADIANS) continue;
        const distance = routeDistanceMeters([state.node, node]);
        const distanceMeters = state.distanceMeters + distance;
        if (distanceMeters > field.maximumDistanceMeters + 0.01) continue;
        const lateralTravelSign = Math.abs(headingRadians) > radians(5)
          ? Math.sign(headingRadians)
          : state.lastLateralTravelSign;
        const reversal = state.lastLateralTravelSign !== 0
          && lateralTravelSign !== 0
          && lateralTravelSign !== state.lastLateralTravelSign ? 1 : 0;
        candidates.push({
          node,
          path: [...state.path, node],
          distanceMeters,
          thermalMeters: state.thermalMeters
            + edgeThermalDistanceMeters(field, input.relativeScores, state.node, node, distance),
          headingRadians,
          turnBurden: state.turnBurden + Math.abs(headingChange),
          bendCount: state.bendCount + (Math.abs(headingChange) > radians(5) ? 1 : 0),
          reversalCount: state.reversalCount + reversal,
          lastLateralTravelSign: lateralTravelSign,
        });
      }
      nextStates.push(...retainHeadingDiversity(candidates, thermalClosenessMeters, field.extraDistancePenalty));
    }
    states = nextStates;
    if (!states.length) break;
  }

  const completed = states.filter((state) => state.node.layerIndex === field.layers.length - 1);
  completed.sort((left, right) => compareStates(left, right, thermalClosenessMeters, field.extraDistancePenalty));

  for (const state of completed) {
    const rawPoints: RoutePoint[] = state.path.map(({ latitude, longitude }) => ({ latitude, longitude }));
    const finalized = finalizedRoute(rawPoints, field, input.relativeScores, directThermalMeters);
    if (finalized) {
      return {
        points: finalized.points,
        directDistanceMeters: field.directDistanceMeters,
        maximumDistanceMeters: field.maximumDistanceMeters,
        routeDistanceMeters: finalized.distanceMeters,
      };
    }
  }

  return {
    points: directPoints,
    directDistanceMeters: field.directDistanceMeters,
    maximumDistanceMeters: field.maximumDistanceMeters,
    routeDistanceMeters: field.directDistanceMeters,
  };
}
