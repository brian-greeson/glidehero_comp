import type { PilotProfileSummary } from '../../../services/profileService.js';
import { initialsForDisplayName } from './shellModel.js';
import type { FlightThumbnailUrls } from '../../../services/flightThumbnailDeliveryService.js';

const avatarColors = ['#1769aa', '#ff6b24', '#17b7ca', '#43a52c', '#7441b6'] as const;

export type ProfileViewOptions = {
  preview?: boolean;
  isCurrent?: boolean;
  isFollowed?: boolean;
  currentPath?: string;
  thumbnailUrls?: ReadonlyMap<string, FlightThumbnailUrls>;
};

export type ProfileView = ReturnType<typeof pilotProfileToView>;

function colorFor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length]!;
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.trunc(value))) : '0';
}

function titleIcon(arenaType: string): 'mountain' | 'flag' | 'globe' {
  if (arenaType === 'country') return 'globe';
  if (arenaType === 'state') return 'flag';
  return 'mountain';
}

function titleTone(arenaType: string): 'green' | 'blue' | 'orange' | 'purple' {
  if (arenaType === 'country') return 'purple';
  if (arenaType === 'state') return 'blue';
  return 'green';
}

/**
 * Adapt the service-owned profile read model to the refreshed profile view.
 * Fields that are not persisted by PilotProfileSummary are intentionally
 * omitted instead of being filled with preview copy.
 */
export function pilotProfileToView(summary: PilotProfileSummary, options: ProfileViewOptions = {}) {
  const profile = {
    userId: summary.userId,
    displayName: summary.displayName,
    initials: initialsForDisplayName(summary.displayName),
    territoryColor: summary.territoryColor,
    followers: formatCount(summary.followerCount ?? 0),
    following: formatCount(summary.followingCount ?? 0),
  };

  const metrics = [
    { label: 'Unique Cells', value: formatCount(summary.lifetimeUniqueCellCount), detail: 'All Time', icon: 'map', tone: 'green' as const },
    { label: 'Flights Uploaded', value: formatCount(summary.completedFlightCount), detail: 'All Time', icon: 'flight', tone: 'purple' as const },
    { label: 'Achievements Earned', value: formatCount(summary.achievementCount), detail: 'All Time', icon: 'trophy', tone: 'orange' as const },
  ];

  const titles = summary.currentArenaLeaderships.map((leadership, index) => ({
    name: leadership.arenaName,
    detail: `${leadership.status === 'joint' ? 'Joint leader' : 'Top cell holder'} · ${formatCount(leadership.cellsClaimed)} cells`,
    since: leadership.leadingSince ? `Since ${leadership.leadingSince}` : '',
    icon: titleIcon(leadership.arenaType),
    tone: titleTone(leadership.arenaType),
    href: leadership.arenaPath,
    isInitiallyVisible: index < 3,
  }));

  const flights = summary.recentFlights.map((flight, index) => ({
    id: flight.flightId,
    date: flight.flightDate || 'Date unavailable',
    distance: flight.distance || '—',
    cells: formatCount(flight.totalCellCount),
    mapTone: (['orange', 'blue', 'cyan', 'purple'] as const)[index % 4]!,
    thumbnail: options.thumbnailUrls?.get(flight.flightId),
    isInitiallyVisible: index < 3,
  }));

  return {
    profile,
    metrics,
    titles,
    flights,
    profileIsCurrent: options.isCurrent ?? false,
    profileIsFollowed: options.isFollowed ?? false,
    currentPath: options.currentPath ?? `/pilots/${summary.userId}`,
    avatarColor: profile.territoryColor || colorFor(summary.userId),
    ...(options.preview ? { glider: { imageSrc: '/images/app-ui/glider-premium.png', brand: 'Ozone', model: 'Enzo 3', color: 'Teal / White' } } : {}),
  };
}
