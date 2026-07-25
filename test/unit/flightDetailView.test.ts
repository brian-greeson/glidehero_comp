import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FlightDetailMapData, FlightDetailSummary } from '../../src/services/flightDetailService.js';
import { createFlightMapPayload, createFlightPageView } from '../../src/views/authenticated/adapters/flightDetailView.js';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

const flightId = '00000000-0000-4000-8000-000000000020';
const ownerId = '00000000-0000-4000-8000-000000000003';
const points = [
  { sequenceNumber: 1, recordedAt: '2026-07-23T14:00:00.000Z', latitude: 40, longitude: -105, gpsAltitudeMeters: 1_500 },
  { sequenceNumber: 2, recordedAt: '2026-07-23T14:10:00.000Z', latitude: 40.1, longitude: -104.9, gpsAltitudeMeters: 1_600 },
];
const summary: FlightDetailSummary = {
  id: flightId,
  ownerUserId: ownerId,
  ownerDisplayName: 'Cloud Dancer',
  territoryColor: '#123456',
  startedAt: new Date('2026-07-23T14:00:00.000Z'),
  endedAt: new Date('2026-07-23T15:02:03.000Z'),
  launchTimezone: 'America/Denver',
  durationSeconds: 3_723,
  launchLatitude: 40,
  launchLongitude: -105,
  progress: {
    directCellCount: 8,
    enclosedCellCount: 3,
    newPersonalCellCount: 6,
    personalCellTotalAfter: 42,
  },
  scores: {
    track: { distanceMeters: 12_345, calcVersion: 1, metadata: {} },
    threePoint: null,
    fourPoint: { distanceMeters: 10_004, calcVersion: 1, metadata: { points } },
    fivePoint: { distanceMeters: 10_005, calcVersion: 1, metadata: { points } },
    sixPoint: null,
  },
  accomplishments: [{
    id: 'achievement-1',
    achievementKey: 'unique_cells_milestone',
    title: '25 Unique Cells',
    description: 'Reached 25 unique Personal Map cells.',
    badgeLabel: '25',
    category: 'general',
    kind: 'threshold',
    tone: 'green',
  }],
};
const mapData: FlightDetailMapData = {
  track: points.map((point) => ({
    ...point,
    recordedAt: new Date(point.recordedAt),
    pressureAltitudeMeters: point.gpsAltitudeMeters - 10,
  })),
  launch: { latitude: 40, longitude: -105 },
  landing: { latitude: 40.1, longitude: -104.9 },
  directCells: { type: 'FeatureCollection', features: [] },
  enclosedCells: { type: 'FeatureCollection', features: [] },
};

describe('flight detail view', () => {
  it('formats the complete summary and keeps every distance slot', () => {
    const view = createFlightPageView(summary);
    expect(view).toMatchObject({
      date: 'Jul 23, 2026',
      time: '8:00 AM',
      timezone: 'MDT',
      duration: '1h 02m',
      directCells: '8',
      enclosedCells: '3',
      totalCells: '11',
      newPersonalCells: '6',
      defaultDistance: 'fivePoint',
    });
    expect(view.distances.map(({ label, value, available }) => ({ label, value, available }))).toEqual([
      { label: 'Track Distance', value: '12.35 km', available: true },
      { label: '3-Point Distance', value: '—', available: false },
      { label: '4-Point Distance', value: '10.00 km', available: true },
      { label: '5-Point Distance', value: '10.01 km', available: true },
      { label: '6-Point Distance', value: '—', available: false },
    ]);
    expect(view.achievements).toHaveLength(1);
    expect(view.achievements[0]?.artworkKey).toBe('cell-explorer');
  });

  it('adapts raw map data and stored score points to the controller contract', () => {
    const payload = createFlightMapPayload(summary, mapData);
    expect(payload.track.geometry.coordinates).toEqual([[-105, 40], [-104.9, 40.1]]);
    expect(payload.launch).toMatchObject({ geometry: { type: 'Point', coordinates: [-105, 40] } });
    expect(payload.scores.fivePoint?.legs.features[0]?.geometry.coordinates).toEqual([
      [-105, 40],
      [-104.9, 40.1],
    ]);
    expect(payload.scores.fivePoint?.turnpoints.features[0]?.properties).toEqual({});
    expect(payload.scores.threePoint).toBeUndefined();
    expect(payload.replay).toEqual({
      flightId,
      pilotUserId: ownerId,
      durationMs: 600_000,
      points: [[-105, 40, 0], [-104.9, 40.1, 600_000]],
    });
  });

  it('keeps ordered points and clamps invalid or duplicate timestamps in replay data', () => {
    const payload = createFlightMapPayload(summary, {
      ...mapData,
      track: [
        { ...mapData.track[0]!, recordedAt: new Date('invalid') },
        { ...mapData.track[0]!, longitude: -104.8, recordedAt: new Date('2026-07-23T14:00:00.000Z') },
        { ...mapData.track[0]!, longitude: -104.7, recordedAt: new Date('2026-07-23T14:00:00.000Z') },
        { ...mapData.track[0]!, longitude: -104.6, recordedAt: new Date('2026-07-23T14:05:00.000Z') },
      ],
    });
    expect(payload.replay).toEqual({
      flightId,
      pilotUserId: ownerId,
      durationMs: 300_000,
      points: [
        [-105, 40, 0],
        [-104.8, 40, 0],
        [-104.7, 40, 0],
        [-104.6, 40, 300_000],
      ],
    });
  });

  it('clamps backward timestamps and preserves duration when the final timestamp is invalid', () => {
    const payload = createFlightMapPayload(summary, {
      ...mapData,
      track: [
        { ...mapData.track[0]!, recordedAt: new Date('2026-07-23T14:00:00.000Z') },
        { ...mapData.track[0]!, longitude: -104.8, recordedAt: new Date('2026-07-23T14:05:00.000Z') },
        { ...mapData.track[0]!, longitude: -104.7, recordedAt: new Date('2026-07-23T14:02:00.000Z') },
        { ...mapData.track[0]!, longitude: -104.6, recordedAt: new Date('invalid') },
      ],
    });
    expect(payload.replay).toEqual({
      flightId,
      pilotUserId: ownerId,
      durationMs: 300_000,
      points: [
        [-105, 40, 0],
        [-104.8, 40, 300_000],
        [-104.7, 40, 300_000],
        [-104.6, 40, 300_000],
      ],
    });
  });

  it('renders MapLibre assets, accessible loading state, disabled missing scores, and all achievements', async () => {
    const shell = createAuthenticatedShellModel({
      page: 'flight',
      user: { displayName: 'Viewer' },
      title: 'Flight · GlideHero',
      showFooter: false,
    });
    const html = await createAuthenticatedPageRenderer()({
      ...shell,
      page: 'flight',
      flight: { ...createFlightPageView(summary), mapStyleUrl: 'https://maps.example/style.json' },
    });
    expect(html).toContain('data-flight-detail-map');
    expect(html).toContain(`data-map-data-url="/v1/flights/${flightId}/map"`);
    expect(html).toContain('data-default-distance="fivePoint"');
    expect(html).toContain('<h2 id="flight-stats-heading">Stats</h2>');
    expect(html).not.toContain('Personal total');
    expect(html).toContain(`href="/pilots/${ownerId}" aria-label="View Cloud Dancer’s pilot profile"`);
    expect(html).toContain('5-Point Distance');
    expect(html).toContain('data-flight-map-status aria-live="polite">Loading flight map…');
    expect(html).toMatch(/data-flight-map-distance="threePoint"[^>]*disabled/);
    expect(html).toContain('25 Unique Cells');
    expect(html).toContain('maplibre-gl@5.16.0');
    expect(html).toContain('/scripts/app-ui/flight.js');
    expect(html).not.toContain('data-map-replay-sync');

    const emptyHtml = await createAuthenticatedPageRenderer()({
      ...shell,
      page: 'flight',
      flight: createFlightPageView({ ...summary, accomplishments: [] }),
    });
    expect(emptyHtml).toContain('No achievements or other accomplishments from this flight.');
  });

  it('keeps the MapLibre container absolutely sized to the full flight stage', () => {
    const css = readFileSync('public/styles/app-ui/flight.css', 'utf8');
    expect(css).toContain(
      '.flight-detail-map-stage > .flight-detail-map { position: absolute; inset: 0; width: 100%; height: 100%; }',
    );
  });
});
