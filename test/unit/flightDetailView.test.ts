import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FlightDetailMapData, FlightDetailSummary } from '../../src/services/flightDetailService.js';
import { createFlightMapPayload, createFlightPageView, createFlightSocialPreview, createPublicFlightPageView } from '../../src/views/authenticated/adapters/flightDetailView.js';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';
import { createPublicFlightPageRenderer } from '../../src/views/publicFlight/renderer.js';

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
  launchGpsAltitudeMeters: 1_500,
  minGpsAltitudeMeters: 1_425,
  maxGpsAltitudeMeters: 1_600,
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
      launchAltitude: '1,500 m',
      minAltitude: '1,425 m',
      maxAltitude: '1,600 m',
      fivePointDistance: '10.01 km',
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

    const unavailable = createFlightPageView({
      ...summary,
      durationSeconds: null,
      launchGpsAltitudeMeters: null,
      minGpsAltitudeMeters: null,
      maxGpsAltitudeMeters: null,
      scores: summary.scores ? { ...summary.scores, fivePoint: null } : null,
    });
    expect(unavailable).toMatchObject({
      duration: '—',
      launchAltitude: '—',
      minAltitude: '—',
      maxAltitude: '—',
      fivePointDistance: '—',
    });
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
      points: [[-105, 40, 0, 1_500], [-104.9, 40.1, 600_000, 1_600]],
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
        [-105, 40, 0, 1_500],
        [-104.8, 40, 0, 1_500],
        [-104.7, 40, 0, 1_500],
        [-104.6, 40, 300_000, 1_500],
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
        [-105, 40, 0, 1_500],
        [-104.8, 40, 300_000, 1_500],
        [-104.7, 40, 300_000, 1_500],
        [-104.6, 40, 300_000, 1_500],
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
    expect(html).toContain('Launch GPS altitude · 1,500 m');
    expect(html).toContain('<dt>Min GPS altitude</dt><dd>1,425 m</dd>');
    expect(html).toContain('<dt>Max GPS altitude</dt><dd>1,600 m</dd>');
    expect(html).toContain('<dt>Max altitude</dt><dd>1,600 m</dd>');
    expect(html).toContain('<dt>Duration</dt><dd>1h 02m</dd>');
    expect(html).toContain('<dt>5-point distance</dt><dd>10.01 km</dd>');
    expect(html).not.toContain('Personal total');
    expect(html).toContain(`href="/pilots/${ownerId}" aria-label="View Cloud Dancer’s pilot profile"`);
    expect(html).toContain('5-Point Distance');
    expect(html).toContain('data-flight-map-status aria-live="polite">Loading flight map…');
    expect(html).toMatch(/data-flight-map-distance="threePoint"[^>]*disabled/);
    expect(html).toContain('25 Unique Cells');
    expect(html).toContain('maplibre-gl@5.16.0');
    expect(html).toContain('/scripts/app-ui/flight.js');
    expect(html).not.toContain('data-map-replay-sync');
    expect(html).not.toContain('data-map-replay-close');
    expect(html.match(/data-map-replay-panel/g)).toHaveLength(2);

    const emptyHtml = await createAuthenticatedPageRenderer()({
      ...shell,
      page: 'flight',
      flight: createFlightPageView({ ...summary, accomplishments: [] }),
    });
    expect(emptyHtml).toContain('No achievements or other accomplishments from this flight.');
  });

  it('renders the complete flight for guests without signed-in-only links or controls', async () => {
    const flight = createPublicFlightPageView(summary);
    const socialPreview = createFlightSocialPreview({
      flight,
      publicOrigin: 'https://glidehero.example',
      imageUrl: 'https://objects.example/flight.webp?signature=temporary',
      imageWidth: 800,
      imageHeight: 450,
    });
    const html = await createPublicFlightPageRenderer()({
      page: 'flight',
      title: 'Cloud Dancer’s flight · GlideHero',
      socialPreview,
      flight: { ...flight, mapStyleUrl: 'https://maps.example/style.json' },
    });

    expect(flight.pilot.href).toBeUndefined();
    expect(flight.achievements[0]?.href).toBeUndefined();
    expect(socialPreview).toEqual({
      description: 'Jul 23, 2026 · 10.01 km 5-point distance · 1h 02m · 11 cells',
      canonicalUrl: `https://glidehero.example/flights/${flightId}`,
      imageUrl: 'https://objects.example/flight.webp?signature=temporary',
      imageAlt: 'Cloud Dancer flight territory preview',
      imageWidth: 800,
      imageHeight: 450,
    });
    expect(html).toContain('<title>Cloud Dancer’s flight · GlideHero</title>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain(`<link rel="canonical" href="https://glidehero.example/flights/${flightId}">`);
    expect(html).toContain('<meta property="og:site_name" content="GlideHero">');
    expect(html).toContain('<meta property="og:title" content="Cloud Dancer’s flight · GlideHero">');
    expect(html).toContain('<meta property="og:description" content="Jul 23, 2026 · 10.01 km 5-point distance · 1h 02m · 11 cells">');
    expect(html).toContain('<meta property="og:image" content="https://objects.example/flight.webp?signature=temporary">');
    expect(html).toContain('<meta property="og:image:width" content="800">');
    expect(html).toContain('<meta property="og:image:height" content="450">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('Join or sign in');
    expect(html).toContain('data-flight-detail-map');
    expect(html).toContain(`data-map-data-url="/v1/flights/${flightId}/map"`);
    expect(html).toContain('25 Unique Cells');
    expect(html).not.toContain('data-upload-trigger');
    expect(html).not.toContain('data-app-account');
    expect(html).not.toContain('class="mobile-navigation"');
    expect(html).not.toContain('/scripts/app-ui/app.js');
    expect(html).not.toContain(`href="/pilots/${ownerId}"`);

    const escapedHtml = await createPublicFlightPageRenderer()({
      page: 'flight',
      title: 'Cloud & <Dancer> flight',
      socialPreview: {
        ...socialPreview,
        description: 'Fast & <high>',
        imageUrl: 'https://objects.example/flight.webp?one=1&two=2',
      },
      flight: { ...flight, mapStyleUrl: 'https://maps.example/style.json' },
    });
    expect(escapedHtml).toContain('content="Cloud &amp; &lt;Dancer&gt; flight"');
    expect(escapedHtml).toContain('content="Fast &amp; &lt;high&gt;"');
    expect(escapedHtml).toContain('flight.webp?one=1&amp;two=2');
  });

  it('keeps the MapLibre container absolutely sized to the full flight stage', () => {
    const css = readFileSync('public/styles/app-ui/flight.css', 'utf8');
    expect(css).toContain(
      '.flight-detail-map-stage > .flight-detail-map { position: absolute; inset: 0; width: 100%; height: 100%; }',
    );
    expect(css).toContain('--flight-sheet-collapsed-height: min(132px, 15svh);');
    expect(css).toContain('height: var(--flight-sheet-collapsed-height);');
    expect(css).toContain('var(--flight-bottom-nav-height) + var(--flight-sheet-collapsed-height)');
    expect(css).toContain('.flight-detail-panel .mobile-map-sheet__content { display: none; }');
    expect(css).toContain('.flight-detail-panel.mobile-map-sheet.is-expanded .mobile-map-sheet__content { display: block;');
  });
});
