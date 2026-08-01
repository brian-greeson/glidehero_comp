export type RoutePoint = { latitude: number; longitude: number };

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
  sampleSpacingMeters: number;
  layers: ThermalRouteSample[][];
  samples: ThermalRouteSample[];
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const TARGET_SAMPLE_SPACING_METERS = 200;
const MINIMUM_PROGRESS_LAYERS = 8;
const MAXIMUM_PROGRESS_LAYERS = 120;
const MAXIMUM_LATERAL_COLUMNS_PER_SIDE = 15;
const MAXIMUM_HEADING_CHANGE_RADIANS = (65 * Math.PI) / 180;
const CORNER_CUT_THRESHOLD_RADIANS = (35 * Math.PI) / 180;
const HEADING_BIN_RADIANS = (15 * Math.PI) / 180;

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
  maximumDeviationPercent: number;
}): ThermalRoutingField {
  const directDistanceMeters = routeDistanceMeters([input.start, input.end]);
  const maximumDistanceMeters = directDistanceMeters * (1 + input.maximumDeviationPercent / 100);
  const progressSegments = Math.max(
    MINIMUM_PROGRESS_LAYERS,
    Math.min(MAXIMUM_PROGRESS_LAYERS, Math.ceil(directDistanceMeters / TARGET_SAMPLE_SPACING_METERS)),
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
        progressSpacingMeters * Math.tan(MAXIMUM_HEADING_CHANGE_RADIANS),
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
    sampleSpacingMeters: progressSpacingMeters,
    layers,
    samples,
  };
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
  lastTurnSign: number;
};

function compareStates(left: SearchState, right: SearchState, thermalClosenessMeters: number): number {
  // Repeated changes in turn direction are zigzags, not a tradeable thermal benefit.
  if (left.reversalCount !== right.reversalCount) return left.reversalCount - right.reversalCount;
  const thermalDifference = right.thermalMeters - left.thermalMeters;
  if (Math.abs(thermalDifference) > thermalClosenessMeters) return thermalDifference;
  if (left.bendCount !== right.bendCount) return left.bendCount - right.bendCount;
  if (left.turnBurden !== right.turnBurden) return left.turnBurden - right.turnBurden;
  if (left.distanceMeters !== right.distanceMeters) return left.distanceMeters - right.distanceMeters;
  return left.path.map((point) => point.sampleIndex).join(',').localeCompare(right.path.map((point) => point.sampleIndex).join(','));
}

function retainHeadingDiversity(candidates: SearchState[], thermalClosenessMeters: number): SearchState[] {
  const bins = new Map<number, SearchState[]>();
  for (const candidate of candidates) {
    const bin = Math.round(candidate.headingRadians / HEADING_BIN_RADIANS);
    const existing = bins.get(bin) ?? [];
    existing.push(candidate);
    bins.set(bin, existing);
  }
  const retained: SearchState[] = [];
  for (const states of bins.values()) {
    states.sort((left, right) => compareStates(left, right, thermalClosenessMeters));
    retained.push(states[0]!);
    const shortest = [...states].sort((left, right) => left.distanceMeters - right.distanceMeters)[0]!;
    if (shortest !== states[0]) retained.push(shortest);
    const strongestThermal = [...states].sort((left, right) => right.thermalMeters - left.thermalMeters)[0]!;
    if (strongestThermal !== states[0] && strongestThermal !== shortest) retained.push(strongestThermal);
  }
  return retained;
}

function sampleScore(scores: ReadonlyMap<number, number>, sampleIndex: number): number {
  return Math.max(0, Math.min(1, scores.get(sampleIndex) ?? 0));
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
    if (Math.abs(normalizeAngle(headings[index]! - headings[index - 1]!)) > MAXIMUM_HEADING_CHANGE_RADIANS) return false;
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
  for (let index = 1; index < points.length - 1; index += 1) {
    const headings = routeHeadings(points, field);
    const change = Math.abs(normalizeAngle(headings[index]! - headings[index - 1]!));
    if (change < CORNER_CUT_THRESHOLD_RADIANS) continue;
    const before = interpolate(points[index - 1]!, points[index]!, 0.72);
    const after = interpolate(points[index]!, points[index + 1]!, 0.28);
    const trial = [...points.slice(0, index), before, after, ...points.slice(index + 1)];
    if (routeDistanceMeters(trial) > field.maximumDistanceMeters + 0.01 || !isForwardSmoothRoute(trial, field)) continue;
    if (weightedThermalDistanceMeters(trial, field, scores) + 0.01 < minimumThermalMeters) continue;
    points = trial;
    index += 1;
  }
  return points;
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
    lastTurnSign: 0,
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
        if (Math.abs(headingChange) > MAXIMUM_HEADING_CHANGE_RADIANS) continue;
        const distance = routeDistanceMeters([state.node, node]);
        const distanceMeters = state.distanceMeters + distance;
        if (distanceMeters > field.maximumDistanceMeters + 0.01) continue;
        const turnSign = Math.abs(headingChange) > radians(5) ? Math.sign(headingChange) : state.lastTurnSign;
        const reversal = state.lastTurnSign !== 0 && turnSign !== 0 && turnSign !== state.lastTurnSign ? 1 : 0;
        candidates.push({
          node,
          path: [...state.path, node],
          distanceMeters,
          thermalMeters: state.thermalMeters
            + (distance * ((sampleScore(input.relativeScores, state.node.sampleIndex) + sampleScore(input.relativeScores, node.sampleIndex)) / 2)),
          headingRadians,
          turnBurden: state.turnBurden + Math.abs(headingChange),
          bendCount: state.bendCount + (Math.abs(headingChange) > radians(5) ? 1 : 0),
          reversalCount: state.reversalCount + reversal,
          lastTurnSign: turnSign,
        });
      }
      nextStates.push(...retainHeadingDiversity(candidates, thermalClosenessMeters));
    }
    states = nextStates;
    if (!states.length) break;
  }

  const completed = states.filter((state) => state.node.layerIndex === field.layers.length - 1);
  completed.sort((left, right) => compareStates(left, right, thermalClosenessMeters));
  const directThermalMeters = weightedThermalDistanceMeters(directPoints, field, input.relativeScores);

  for (const state of completed) {
    const rawPoints: RoutePoint[] = state.path.map(({ latitude, longitude }) => ({ latitude, longitude }));
    const rawThermalMeters = weightedThermalDistanceMeters(rawPoints, field, input.relativeScores);
    const extraDistanceMeters = Math.max(0, routeDistanceMeters(rawPoints) - field.directDistanceMeters);
    const meaningfulImprovementMeters = Math.max(75, field.directDistanceMeters * 0.01, extraDistanceMeters * 0.35);
    if (rawThermalMeters < directThermalMeters + meaningfulImprovementMeters) continue;
    const minimumThermalMeters = rawThermalMeters - Math.max(50, rawThermalMeters * 0.03);
    const simplified = simplifyRoute(rawPoints, field, input.relativeScores, minimumThermalMeters);
    const rounded = cutCorners(simplified, field, input.relativeScores, minimumThermalMeters);
    const routeDistance = routeDistanceMeters(rounded);
    if (routeDistance <= field.maximumDistanceMeters + 0.01 && isForwardSmoothRoute(rounded, field)) {
      return {
        points: rounded,
        directDistanceMeters: field.directDistanceMeters,
        maximumDistanceMeters: field.maximumDistanceMeters,
        routeDistanceMeters: routeDistance,
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
