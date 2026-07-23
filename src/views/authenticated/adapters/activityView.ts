import type { ActivityFeedItem } from '../../../services/activityService.js';
import type { PilotSearchResult } from '../../../services/followService.js';
import type { ActivityPilotResultView } from '../models.js';
import { resolveAchievementArtworkKey } from '../achievementArtwork.js';
import type { FlightThumbnailUrls } from '../../../services/flightThumbnailDeliveryService.js';

const avatarColors = ['#1769aa', '#ff6b24', '#17b7ca', '#43a52c', '#7441b6'] as const;

function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase();
}

function colorFor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length]!;
}

export function activityPilotResultToView(result: PilotSearchResult): ActivityPilotResultView {
  return {
    userId: result.userId,
    displayName: result.displayName,
    initials: initials(result.displayName),
    color: colorFor(result.userId),
    href: `/pilots/${result.userId}`,
    isFollowing: result.isFollowing,
  };
}

function timeAgo(value: Date): string {
  const elapsed = Math.max(0, Date.now() - value.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Converts the service-owned activity read model into the refreshed template
 * shape. Keeping this adapter separate lets the preview fixture retain its
 * richer mockup-only fields while production cards stay endpoint-backed.
 */
export function activityFeedItemToView(item: ActivityFeedItem, options: { thumbnailUrls?: ReadonlyMap<string, FlightThumbnailUrls> } = {}) {
  const flight = item.activityType === 'flight' && item.sourceFlightId
    ? {
      id: item.sourceFlightId ?? item.id,
      href: `/flights/${item.sourceFlightId}`,
      date: item.flightDate ?? 'Date unavailable',
      distance: item.distance ?? '—',
      cells: item.totalCellCount === undefined ? '—' : String(item.totalCellCount),
      mapTone: 'cyan' as const,
      thumbnail: options.thumbnailUrls?.get(item.sourceFlightId),
    }
    : undefined;
  const detail = item.activityType === 'flight'
    ? [item.distance, item.duration].filter(Boolean).join(' · ') || 'Completed a flight'
    : 'Activity update';
  return {
    id: item.id,
    activityId: item.id,
    actorUserId: item.actorUserId,
    kind: item.activityType === 'flight' ? 'flight' as const : 'achievements' as const,
    pilot: {
      userId: item.actorUserId,
      displayName: item.actorDisplayName,
      initials: initials(item.actorDisplayName),
      color: colorFor(item.actorUserId),
      href: `/pilots/${item.actorUserId}`,
    },
    timeAgo: timeAgo(item.publishedAt),
    publishedAtIso: item.publishedAtIso,
    publishedAtLabel: item.publishedAtLabel,
    title: item.activityType === 'flight' ? `${item.actorDisplayName} completed a flight` : `${item.actorDisplayName} shared an activity`,
    detail,
    arena: item.location ?? 'Unknown location',
    flight,
    flightDate: item.flightDate,
    duration: item.duration,
    distance: item.distance,
    totalCellCount: item.totalCellCount,
    achievements: item.accomplishments.map((accomplishment) => ({
      key: accomplishment.id,
      artworkKey: resolveAchievementArtworkKey(accomplishment),
      title: accomplishment.title,
      description: accomplishment.description,
      badgeLabel: accomplishment.badgeLabel,
      tone: accomplishment.tone,
      category: accomplishment.category,
      kind: accomplishment.kind,
      earnedDate: item.flightDate,
      href: accomplishment.arenaPath,
    })),
    likeCount: item.likeCount,
    viewerHasLiked: item.viewerHasLiked,
    isOwn: item.isOwn,
    progress: undefined,
  };
}

export function activityFeedToViews(items: readonly ActivityFeedItem[], options: { thumbnailUrls?: ReadonlyMap<string, FlightThumbnailUrls> } = {}) {
  return items.map((item) => activityFeedItemToView(item, options));
}
