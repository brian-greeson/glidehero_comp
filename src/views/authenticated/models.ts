export type AuthenticatedPage = 'map' | 'activity' | 'achievements' | 'profile';

export type AuthenticatedUserView = {
  displayName: string;
  initials: string;
  isAdmin: boolean;
};

export type NavigationItemView = {
  page: AuthenticatedPage;
  label: string;
  icon: 'map' | 'activity' | 'trophy' | 'profile';
  href: string;
};

export type MetricView = {
  label: string;
  value: string;
  detail?: string;
  icon: string;
  tone: 'blue' | 'green' | 'purple' | 'orange';
};

export type PilotView = {
  userId?: string;
  displayName: string;
  initials: string;
  color: string;
  href?: string;
};

export type ActivityPilotResultView = {
  userId: string;
  displayName: string;
  initials: string;
  color: string;
  href: string;
  isFollowing: boolean;
};

export type AchievementView = {
  key: string;
  artworkKey: import('./achievementArtwork.js').AchievementArtworkKey;
  title: string;
  description: string;
  badgeLabel: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
  earnedDate?: string;
  current?: string;
  target?: string;
  percent?: number;
  isInitiallyVisible?: boolean;
};

export type FlightView = {
  id: string;
  pilot?: PilotView;
  date: string;
  arena?: string;
  distance: string;
  cells: string;
  achievements?: string;
  mapTone: 'orange' | 'blue' | 'cyan' | 'purple';
  thumbnail?: { wideUrl: string; squareUrl: string };
};

export type AuthenticatedShellModel = {
  page: AuthenticatedPage;
  title: string;
  user: AuthenticatedUserView;
  navigation: NavigationItemView[];
  donateUrl: string;
  adminUrl: string;
  logoutUrl: string;
  showFooter: boolean;
  preview: boolean;
};

/**
 * Inputs needed to construct the shared authenticated application shell.
 *
 * Page-specific adapters should spread the result into their page model rather
 * than rebuilding navigation and account actions independently.
 */
export type AuthenticatedShellInput = {
  page: AuthenticatedPage;
  user: { displayName: string; email?: string };
  isAdmin?: boolean;
  mapHref?: string;
  donateUrl?: string;
  adminUrl?: string;
  logoutUrl?: string;
  showFooter?: boolean;
  preview?: boolean;
  title?: string;
};

export type MapPageModel = AuthenticatedShellModel & {
  page: 'map';
  mode: 'personal' | 'competitive';
  period: 'all-time' | 'current-month';
  location: string;
  metrics: MetricView[];
  leaderboard: Array<{ rank: number; pilot: PilotView; cells: string; isCurrent: boolean }>;
  selectedFlight?: FlightView;
  selectedCell?: { name: string; owner: string; altitude: string; lastClaimed: string };
  mapStyleUrl?: string;
  currentUserId?: string;
  territoryColor?: string;
  territoryTileMinimumZoom?: number;
  territoryTileMaximumZoom?: number;
  arenaSourceId?: number;
  focusArenaSourceId?: number;
  mapEmptyState?: string;
};

export type ActivityEventView = {
  id: string;
  kind: 'achievements' | 'flight' | 'challenge';
  pilot: PilotView;
  timeAgo: string;
  title: string;
  detail: string;
  arena: string;
  likes?: string;
  comments?: string;
  flight?: FlightView;
  achievements: AchievementView[];
  progress?: { current: string; target: string; percent: number };
};

export type ActivityPageModel = AuthenticatedShellModel & {
  page: 'activity';
  metrics: MetricView[];
  events: ActivityEventView[];
  following: Array<{ pilot: PilotView; detail: string; timeAgo: string }>;
  weekly: Array<{ label: string; value: string; change: string; icon: string }>;
  activitySearch?: string;
  activityPilotResults?: ActivityPilotResultView[];
  activityReturnTo?: string;
  activityScopeLinks?: { all: string; following: string; yours: string };
  activityScope?: 'all' | 'following' | 'yours';
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
};

export type AchievementsPageModel = AuthenticatedShellModel & {
  page: 'achievements';
  metrics: MetricView[];
  earned: AchievementView[];
  earnedHasExtras: boolean;
  inProgress: AchievementView[];
  recentlyEarned: AchievementView[];
};

export type ProfileTitleView = {
  name: string;
  detail: string;
  since: string;
  icon: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
};

export type ProfilePageModel = AuthenticatedShellModel & {
  page: 'profile';
  profile: {
    userId?: string;
    displayName: string;
    initials: string;
    handle?: string;
    tier?: string;
    location?: string;
    bio?: string;
    memberSince?: string;
    followers: string;
    following: string;
  };
  metrics: MetricView[];
  titles: ProfileTitleView[];
  flights: FlightView[];
  glider?: { imageSrc?: string; brand?: string; model?: string; color?: string };
};

export type AuthenticatedPageModel = MapPageModel | ActivityPageModel | AchievementsPageModel | ProfilePageModel;
