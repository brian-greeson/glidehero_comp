export type AuthenticatedPage = 'map' | 'plan' | 'activity' | 'achievements' | 'profile' | 'flight';

export type AuthenticatedUserView = {
  displayName: string;
  initials: string;
  isAdmin: boolean;
};

export type NavigationItemView = {
  page: AuthenticatedPage;
  label: string;
  icon: 'map' | 'plan' | 'activity' | 'trophy' | 'profile';
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
  href?: string;
};

export type FlightView = {
  id: string;
  date: string;
  arena?: string;
  distance: string;
  cells: string;
  thumbnail?: { wideUrl: string; squareUrl: string };
  href?: string;
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
  gettingStarted?: { dismissed: boolean };
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
  title?: string;
};

export type MapPageModel = AuthenticatedShellModel & {
  page: 'map';
  mode: 'personal' | 'following' | 'competitive';
  period: 'all-time' | 'current-month';
  location: string | null;
  locationClearHref?: string;
  metrics: MetricView[];
  leaderboard: Array<{ rank: number; pilot: PilotView; cells: string; isCurrent: boolean }>;
  mapModeHrefs?: {
    personal: string;
    following: string;
    competitive: string;
  };
  mapStyleUrl?: string;
  currentUserId?: string;
  territoryColor?: string;
  territoryTileMinimumZoom?: number;
  territoryTileMaximumZoom?: number;
  arenaSourceId?: number;
  focusArenaSourceId?: number;
  mapEmptyState?: string;
};

export type PlanPageModel = AuthenticatedShellModel & {
  page: 'plan';
  mapStyleUrl: string;
  thermalTileUrl: string;
  defaultDeviationPercent: number;
};

export type ActivityEventView = {
  id: string;
  kind: 'achievements' | 'flight';
  pilot: PilotView;
  timeAgo: string;
  title: string;
  detail: string;
  arena: string;
  flight?: FlightView;
  achievements: AchievementView[];
};

export type ActivityStatisticWinnerView = {
  href: string;
  value: string;
  pilot: PilotView;
  achievements: AchievementView[];
  achievementOverflowCount: number;
};

export type ActivityPeriodStatisticsView = {
  flightCount: string;
  mostAccomplishments: ActivityStatisticWinnerView | null;
  mostCells: ActivityStatisticWinnerView | null;
  greatestFivePointDistance: ActivityStatisticWinnerView | null;
};

export type ActivityStatisticsView = {
  monthly: ActivityPeriodStatisticsView;
  daily: ActivityPeriodStatisticsView;
};

export type OnboardingStepView = {
  key: 'profile' | 'first-flight' | 'personal-map' | 'follow-pilots' | 'competitive-map' | 'glider' | 'history';
  label: string;
  description: string;
  complete: boolean;
  actionLabel: string;
  href: string;
  uploadMode?: 'recent' | 'history';
  instructions: Array<{ number: number; title: string; detail: string }>;
};

export type OnboardingView = {
  dismissed: boolean;
  completeCount: number;
  totalCount: number;
  coreComplete: boolean;
  allComplete: boolean;
  shouldPoll: boolean;
  statusKey: string;
  firstFlightComplete: boolean;
  steps: OnboardingStepView[];
  selectedStep?: OnboardingStepView;
};

export type ActivityPageModel = AuthenticatedShellModel & {
  page: 'activity';
  events: ActivityEventView[];
  activityStats: ActivityStatisticsView;
  activitySearch?: string;
  activityPilotResults?: ActivityPilotResultView[];
  activityReturnTo?: string;
  activityScopeLinks?: { following: string; yours: string };
  activityScope?: 'following' | 'yours';
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
  onboarding?: OnboardingView;
  onboardingDismissedNotice?: boolean;
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
  glider: {
    modelId: string;
    manufacturer: string;
    model: string;
    size: string;
    year: string;
    competitionId: string;
    enRating: string;
    hours: string;
  } | null;
  gliderIsCurrent: boolean;
  gliderCurrentYear: number;
  gliderEditor: {
    modelId: string;
    manufacturer: string;
    model: string;
    size: string;
    year: string;
    competitionId: string;
    hours: string;
    error: string;
    isOpen: boolean;
  };
};

export type FlightDistanceView = {
  key: 'track' | 'threePoint' | 'fourPoint' | 'fivePoint' | 'sixPoint';
  label: string;
  value: string;
  available: boolean;
};

export type FlightPageModel = AuthenticatedShellModel & {
  page: 'flight';
  flight: {
    id: string;
    pilot: PilotView;
    date: string;
    time: string;
    timezone: string;
    duration: string;
    directCells: string;
    enclosedCells: string;
    totalCells: string;
    newPersonalCells: string;
    distances: FlightDistanceView[];
    defaultDistance: FlightDistanceView['key'];
    territoryColor: string;
    mapStyleUrl?: string;
    mapDataUrl: string;
    achievements: AchievementView[];
  };
};

export type AuthenticatedPageModel = MapPageModel | PlanPageModel | ActivityPageModel | AchievementsPageModel | ProfilePageModel | FlightPageModel;
