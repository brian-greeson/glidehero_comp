import type { FlightMapListItem, FlightMapListPage } from '../../../services/flightMapService.js';
import type { FlightThumbnailUrls } from '../../../services/flightThumbnailDeliveryService.js';

function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase();
}

function distance(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
}

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function dateLabel(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date);
  }
}

function timeAgo(value: string, now: Date): string {
  const date = new Date(value);
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function coordinate(value: number | null): string | null {
  return value === null || !Number.isFinite(value) ? null : value.toFixed(4);
}

function location(item: FlightMapListItem): string {
  if (item.launchName) return item.launchName;
  const latitude = coordinate(item.launchLatitude);
  const longitude = coordinate(item.launchLongitude);
  return latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : 'Unknown launch';
}

export function flightMapListPageToPayload(
  page: FlightMapListPage,
  options: { thumbnailUrls?: ReadonlyMap<string, FlightThumbnailUrls>; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  return {
    items: page.items.map((item) => ({
      id: item.flightId,
      flightId: item.flightId,
      href: `/flights/${item.flightId}`,
      pilot: {
        id: item.pilotUserId,
        displayName: item.pilotDisplayName,
        initials: initials(item.pilotDisplayName),
        color: item.pilotColor,
      },
      startedAt: item.startedAt,
      dateLabel: dateLabel(item.startedAt, item.launchTimezone),
      timeAgo: timeAgo(item.startedAt, now),
      location: location(item),
      distanceMeters: item.fivePointDistanceMeters,
      distanceLabel: distance(item.fivePointDistanceMeters),
      durationSeconds: item.durationSeconds,
      durationLabel: duration(item.durationSeconds),
      thumbnailUrl: options.thumbnailUrls?.get(item.flightId)?.squareUrl,
      bounds: item.bounds,
    })),
    nextCursor: page.nextCursor,
  };
}
