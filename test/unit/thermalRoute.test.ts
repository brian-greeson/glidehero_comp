import { describe, expect, it } from 'vitest';
import {
  createThermalRoutingField,
  planSampleSpacingMeters,
  routeDistanceMeters,
  thermalGuidedLeg,
  weightedThermalDistanceMeters,
  type ThermalRouteSample,
  type ThermalRoutingField,
} from '../../src/domain/thermal/thermalRoute.js';

describe('thermal-guided route domain', () => {
  const start = { latitude: 39, longitude: -105 };
  const end = { latitude: 39, longitude: -104.91 };

  function field(routingPriority: 'shorter' | 'balanced' | 'thermal' = 'thermal'): ThermalRoutingField {
    return createThermalRoutingField({ start, end, routingPriority });
  }

  function scoresFor(
    routingField: ThermalRoutingField,
    score: (sample: ThermalRouteSample) => number,
  ): ReadonlyMap<number, number> {
    return new Map(routingField.samples.map((sample) => [sample.sampleIndex, score(sample)]));
  }

  it('keeps routes direct when no thermal activity is scored', () => {
    const routingField = field('shorter');
    const result = thermalGuidedLeg({ field: routingField, relativeScores: new Map() });
    expect(result.points).toEqual([start, end]);
    expect(result.routeDistanceMeters).toBe(result.directDistanceMeters);
  });

  it('enters, follows, and leaves a continuous thermal corridor without zigzags', () => {
    const routingField = field();
    const corridorOffset = 650;
    const scores = scoresFor(routingField, (sample) => {
      const inCorridor = sample.progressMeters > routingField.directDistanceMeters * 0.18
        && sample.progressMeters < routingField.directDistanceMeters * 0.8
        && Math.abs(sample.lateralOffsetMeters - corridorOffset) < 260;
      const isolatedDistraction = sample.layerIndex % 9 === 0
        && Math.abs(Math.abs(sample.lateralOffsetMeters) - 1_300) < 260;
      if (inCorridor) return 0.75;
      if (isolatedDistraction) return 1;
      return 0;
    });

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    expect(result.points[0]).toEqual(start);
    expect(result.points.at(-1)).toEqual(end);
    expect(result.points.length).toBeGreaterThan(2);
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
    expect(weightedThermalDistanceMeters(result.points, routingField, scores))
      .toBeGreaterThan(weightedThermalDistanceMeters([start, end], routingField, scores) + 500);

    const longitudes = result.points.map((point) => point.longitude);
    expect(longitudes.every((longitude, index) => index === 0 || longitude > longitudes[index - 1]!)).toBe(true);
    const interiorLatitudes = result.points.slice(1, -1).map((point) => point.latitude);
    expect(interiorLatitudes.every((latitude) => latitude >= start.latitude)).toBe(true);
  });

  it('prefers a stronger corridor over an equally long weak corridor', () => {
    const routingField = field();
    const scores = scoresFor(routingField, (sample) => {
      const inMiddle = sample.progressMeters > routingField.directDistanceMeters * 0.2
        && sample.progressMeters < routingField.directDistanceMeters * 0.8;
      if (!inMiddle) return 0;
      if (Math.abs(sample.lateralOffsetMeters - 600) < 250) return 1;
      if (Math.abs(sample.lateralOffsetMeters + 600) < 250) return 0.25;
      return 0;
    });

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    expect(Math.max(...result.points.map((point) => point.latitude))).toBeGreaterThan(start.latitude);
    expect(Math.min(...result.points.map((point) => point.latitude))).toBe(start.latitude);
  });

  it('bridges a small gap instead of leaving and re-entering the same corridor', () => {
    const routingField = field();
    const scores = scoresFor(routingField, (sample) => {
      const inCorridor = sample.progressMeters > routingField.directDistanceMeters * 0.2
        && sample.progressMeters < routingField.directDistanceMeters * 0.8
        && Math.abs(sample.lateralOffsetMeters - 600) < 250;
      const inGap = sample.progressMeters > routingField.directDistanceMeters * 0.48
        && sample.progressMeters < routingField.directDistanceMeters * 0.54;
      return inCorridor && !inGap ? 0.75 : 0;
    });

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    const interior = result.points.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    expect(interior.every((point) => point.latitude >= start.latitude)).toBe(true);
    expect(result.points.length).toBeLessThanOrEqual(8);
  });

  it('follows an offset cross-track corridor with one entry and one exit', () => {
    const diagonalStart = { latitude: 39.95, longitude: -105.05 };
    const diagonalEnd = { latitude: 39.9, longitude: -104.95 };
    const routingField = createThermalRoutingField({
      start: diagonalStart,
      end: diagonalEnd,
      routingPriority: 'thermal',
    });
    const scores = scoresFor(routingField, (sample) => {
      const inVerticalCorridor = Math.abs(sample.longitude + 105) < 0.003
        && sample.latitude < 39.94
        && sample.latitude > 39.885;
      return inVerticalCorridor ? 0.75 : 0;
    });

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    const corridorPoints = result.points.filter((point) => Math.abs(point.longitude + 105) < 0.006);
    expect(corridorPoints.length).toBeGreaterThanOrEqual(2);
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
    expect(weightedThermalDistanceMeters(result.points, routingField, scores))
      .toBeGreaterThan(weightedThermalDistanceMeters([diagonalStart, diagonalEnd], routingField, scores) + 300);
  });

  it('finds a long thermal corridor instead of staying direct on a long leg', () => {
    const longStart = { latitude: 39.75, longitude: -105.35 };
    const longEnd = { latitude: 40.15, longitude: -105.25 };
    const routingField = createThermalRoutingField({
      start: longStart,
      end: longEnd,
      routingPriority: 'thermal',
    });
    const scores = scoresFor(routingField, (sample) => {
      const inFoothillCorridor = Math.abs(sample.longitude + 105.28) < 0.006
        && sample.latitude > 39.82
        && sample.latitude < 40.08;
      return inFoothillCorridor ? 0.85 : 0;
    });

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    const corridorPoints = result.points.filter((point) => Math.abs(point.longitude + 105.28) < 0.012);
    expect(result.points[0]).toEqual(longStart);
    expect(result.points.at(-1)).toEqual(longEnd);
    expect(corridorPoints.length).toBeGreaterThanOrEqual(2);
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
    expect(weightedThermalDistanceMeters(result.points, routingField, scores))
      .toBeGreaterThan(weightedThermalDistanceMeters([longStart, longEnd], routingField, scores) + 5_000);
  });

  it('uses the direct route when thermal improvement is not meaningful', () => {
    const routingField = field();
    const scores = scoresFor(routingField, (sample) => (
      sample.layerIndex === Math.floor(routingField.layers.length / 2)
        && sample.lateralOffsetMeters > 500 ? 0.25 : 0
    ));

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    expect(result.points).toEqual([start, end]);
  });

  it('never exceeds the hard per-leg distance ceiling', () => {
    const routingField = field('shorter');
    const scores = scoresFor(routingField, (sample) => (Math.abs(sample.lateralOffsetMeters) > 500 ? 1 : 0));
    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });
    expect(routeDistanceMeters(result.points)).toBeLessThanOrEqual(routingField.maximumDistanceMeters + 0.01);
  });

  it.each([25_000, 50_000, 75_000, 100_000])(
    'keeps narrow thermal corridors discoverable on a %i meter leg',
    (distanceMeters) => {
      const longStart = { latitude: 39, longitude: -105 };
      const longEnd = {
        latitude: 39,
        longitude: -105 + (distanceMeters / (111_320 * Math.cos((39 * Math.PI) / 180))),
      };
      const routingField = createThermalRoutingField({
        start: longStart,
        end: longEnd,
        routingPriority: 'balanced',
      });
      const corridorOffset = 3_500;
      const scores = scoresFor(routingField, (sample) => (
        sample.progressMeters > routingField.directDistanceMeters * 0.15
        && sample.progressMeters < routingField.directDistanceMeters * 0.85
        && Math.abs(sample.lateralOffsetMeters - corridorOffset) < 250 ? 0.85 : 0
      ));

      const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });

      expect(routingField.sampleSpacingMeters).toBeLessThanOrEqual(225);
      expect(result.points.length).toBeGreaterThan(2);
      expect(result.points.length).toBeLessThanOrEqual(8);
      expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
    },
  );

  it('makes thermal priority permit a larger detour than shorter priority', () => {
    const shorter = field('shorter');
    const thermal = field('thermal');
    expect(shorter.extraDistancePenalty).toBeGreaterThan(thermal.extraDistancePenalty);
    expect(shorter.maximumDistanceMeters).toBeLessThan(thermal.maximumDistanceMeters);
  });

  it.each([
    ['east-west', { latitude: 39, longitude: -103.844 }],
    ['north-south', { latitude: 39.9, longitude: -105 }],
    ['diagonal', { latitude: 39.636, longitude: -104.182 }],
  ])('routes a narrow offset corridor across a 100 km %s leg', (_orientation, longEnd) => {
    const longStart = { latitude: 39, longitude: -105 };
    const routingField = createThermalRoutingField({ start: longStart, end: longEnd, routingPriority: 'balanced' });
    const scores = scoresFor(routingField, (sample) => (
      sample.progressMeters > routingField.directDistanceMeters * 0.2
      && sample.progressMeters < routingField.directDistanceMeters * 0.8
      && Math.abs(sample.lateralOffsetMeters - 3_500) < 250 ? 0.85 : 0
    ));

    const result = thermalGuidedLeg({ field: routingField, relativeScores: scores });

    expect(routingField.directDistanceMeters).toBeGreaterThan(95_000);
    expect(routingField.directDistanceMeters).toBeLessThan(105_000);
    expect(result.points.length).toBeGreaterThan(2);
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
  });

  it('preserves 200 meter resolution for one 100 km leg but bounds a 23-leg plan', () => {
    expect(planSampleSpacingMeters(100_000)).toBe(200);
    const sharedSpacing = planSampleSpacingMeters(23 * 100_000);
    const longEnd = { latitude: 39, longitude: -103.844 };
    const fields = Array.from({ length: 23 }, () => createThermalRoutingField({
      start: { latitude: 39, longitude: -105 },
      end: longEnd,
      routingPriority: 'balanced',
      targetSampleSpacingMeters: sharedSpacing,
    }));

    expect(sharedSpacing).toBe(4_600);
    expect(fields.reduce((total, routingField) => total + routingField.layers.length, 0)).toBeLessThanOrEqual(550);
    expect(fields.reduce((total, routingField) => total + routingField.samples.length, 0)).toBeLessThan(20_000);
  });
});
