import type {
  FlightDetailMapData,
  FlightDetailScore,
  FlightDetailSummary,
} from '../../../services/flightDetailService.js';
import type { NPointDistanceMetadata } from '../../../db/schema.js';
import { resolveAchievementArtworkKey } from '../achievementArtwork.js';
import { initialsForDisplayName } from './shellModel.js';
import type { FlightPageModel } from '../models.js';

export type FlightSocialPreview = {
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
};

type ScoreKey = FlightPageModel['flight']['distances'][number]['key'];

const distanceLabels: ReadonlyArray<{ key: ScoreKey; label: string }> = [
  { key: 'track', label: 'Track Distance' },
  { key: 'threePoint', label: '3-Point Distance' },
  { key: 'fourPoint', label: '4-Point Distance' },
  { key: 'fivePoint', label: '5-Point Distance' },
  { key: 'sixPoint', label: '6-Point Distance' },
];

function launchParts(startedAt: Date | null, timeZone: string | null) {
  if (!startedAt) return { date: 'Date unavailable', time: 'Time unavailable', timezone: timeZone ?? 'UTC' };
  let resolvedTimeZone = timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: resolvedTimeZone }).format(startedAt);
  } catch {
    resolvedTimeZone = 'UTC';
  }
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(startedAt);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(startedAt);
  const timezone = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    timeZoneName: 'short',
  }).formatToParts(startedAt).find((part) => part.type === 'timeZoneName')?.value ?? resolvedTimeZone;
  return { date, time, timezone };
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
  return `${remainingSeconds}s`;
}

function altitude(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(meters)} m`;
}

export function createFlightPageView(summary: FlightDetailSummary): FlightPageModel['flight'] {
  const launch = launchParts(summary.startedAt, summary.launchTimezone);
  const distances = distanceLabels.map(({ key, label }) => {
    const score = summary.scores?.[key] ?? null;
    return {
      key,
      label,
      value: score ? `${(score.distanceMeters / 1_000).toFixed(2)} km` : '—',
      available: Boolean(score),
    };
  });
  const progress = summary.progress;
  return {
    id: summary.id,
    pilot: {
      userId: summary.ownerUserId,
      displayName: summary.ownerDisplayName,
      initials: initialsForDisplayName(summary.ownerDisplayName),
      color: summary.territoryColor,
      href: `/pilots/${summary.ownerUserId}`,
    },
    ...launch,
    duration: duration(summary.durationSeconds),
    launchAltitude: altitude(summary.launchGpsAltitudeMeters),
    minAltitude: altitude(summary.minGpsAltitudeMeters),
    maxAltitude: altitude(summary.maxGpsAltitudeMeters),
    fivePointDistance: distances.find(({ key }) => key === 'fivePoint')?.value ?? '—',
    directCells: progress ? String(progress.directCellCount) : '—',
    enclosedCells: progress ? String(progress.enclosedCellCount) : '—',
    totalCells: progress ? String(progress.directCellCount + progress.enclosedCellCount) : '—',
    newPersonalCells: progress ? String(progress.newPersonalCellCount) : '—',
    distances,
    defaultDistance: summary.scores?.fivePoint ? 'fivePoint' : 'track',
    territoryColor: summary.territoryColor,
    mapDataUrl: `/v1/flights/${summary.id}/map`,
    achievements: summary.accomplishments.map((accomplishment) => ({
      key: accomplishment.id,
      artworkKey: resolveAchievementArtworkKey(accomplishment),
      title: accomplishment.title,
      description: accomplishment.description,
      badgeLabel: accomplishment.badgeLabel,
      tone: accomplishment.tone,
      href: accomplishment.arenaPath,
    })),
  };
}

/** Remove links to signed-in-only surfaces while retaining public flight content. */
export function createPublicFlightPageView(summary: FlightDetailSummary): FlightPageModel['flight'] {
  const view = createFlightPageView(summary);
  const pilot = { ...view.pilot };
  delete pilot.href;
  return {
    ...view,
    pilot,
    achievements: view.achievements.map((achievement) => {
      const publicAchievement = { ...achievement };
      delete publicAchievement.href;
      return publicAchievement;
    }),
  };
}

export function createFlightSocialPreview(input: {
  flight: FlightPageModel['flight'];
  publicOrigin: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
}): FlightSocialPreview {
  const selectedDistance = input.flight.distances.find(({ key }) => key === input.flight.defaultDistance);
  const descriptionParts = [
    input.flight.date === 'Date unavailable' ? null : input.flight.date,
    selectedDistance?.available
      ? `${selectedDistance.value} ${selectedDistance.key === 'track' ? 'track' : '5-point'} distance`
      : null,
    input.flight.duration === '—' ? null : input.flight.duration,
    input.flight.totalCells === '—' ? null : `${input.flight.totalCells} cells`,
  ].filter((part): part is string => Boolean(part));
  const origin = input.publicOrigin.endsWith('/') ? input.publicOrigin : `${input.publicOrigin}/`;
  return {
    description: descriptionParts.join(' · ') || 'View this flight on GlideHero.',
    canonicalUrl: new URL(`flights/${input.flight.id}`, origin).toString(),
    imageUrl: input.imageUrl,
    imageAlt: `${input.flight.pilot.displayName} flight territory preview`,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
  };
}

function pointFeature(point: { latitude: number; longitude: number } | null) {
  return point
    ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } }
    : { type: 'FeatureCollection' as const, features: [] };
}

function scoreGeoJson(score: FlightDetailScore<NPointDistanceMetadata>) {
  const points = score.metadata.points;
  return {
    legs: {
      type: 'FeatureCollection' as const,
      features: points.slice(1).map((point, index) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [points[index]!.longitude, points[index]!.latitude],
            [point.longitude, point.latitude],
          ],
        },
      })),
    },
    turnpoints: {
      type: 'FeatureCollection' as const,
      features: points.map((point) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] },
      })),
    },
  };
}

export function createFlightMapPayload(summary: FlightDetailSummary, mapData: FlightDetailMapData) {
  const scores: Record<string, ReturnType<typeof scoreGeoJson>> = {};
  for (const key of ['threePoint', 'fourPoint', 'fivePoint', 'sixPoint'] as const) {
    const score = summary.scores?.[key];
    if (score) scores[key] = scoreGeoJson(score);
  }
  let firstTimestamp: number | undefined;
  let previousElapsedMs = 0;
  const replayPoints = mapData.track.map((point) => {
    const timestamp = point.recordedAt.getTime();
    if (Number.isFinite(timestamp)) {
      firstTimestamp ??= timestamp;
      previousElapsedMs = Math.max(previousElapsedMs, timestamp - firstTimestamp);
    }
    return [point.longitude, point.latitude, previousElapsedMs, point.gpsAltitudeMeters] as [number, number, number, number];
  });
  return {
    territoryColor: summary.territoryColor,
    directCells: mapData.directCells,
    enclosedCells: mapData.enclosedCells,
    track: {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: mapData.track.map((point) => [point.longitude, point.latitude]),
      },
    },
    launch: pointFeature(mapData.launch),
    landing: pointFeature(mapData.landing),
    scores,
    replay: {
      flightId: summary.id,
      pilotUserId: summary.ownerUserId,
      durationMs: replayPoints.at(-1)?.[2] ?? 0,
      points: replayPoints,
    },
  };
}
