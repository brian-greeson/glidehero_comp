export type AuthenticatedPage = 'map' | 'plan' | 'activity' | 'achievements' | 'profile' | 'flight' | 'group';

export type PrimaryNavigationPage = 'map' | 'plan' | 'my-flights' | 'profile';

export type AuthenticatedUserView = {
  displayName: string;
  initials: string;
  isAdmin: boolean;
};

export type NavigationItemView = {
  page: PrimaryNavigationPage;
  label: string;
  icon: 'map' | 'plan' | 'flight' | 'profile';
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

export type FlightTableRowView = {
  id: string;
  href: string;
  date: string;
  time: string;
  launchTimestamp: number | null;
  distance: string;
  distanceMeters: number | null;
  duration: string;
  durationSeconds: number | null;
  thumbnail?: { wideUrl: string; squareUrl: string };
};

export type PersonalRecordView = {
  key: 'five_point_distance' | 'duration' | 'gps_altitude';
  label: string;
  value: string;
  date: string;
  href: string;
  icon: 'flight' | 'calendar' | 'mountain';
};

export type AuthenticatedShellModel = {
  page: AuthenticatedPage;
  activeNavigationPage: PrimaryNavigationPage | null;
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
  activeNavigationPage?: PrimaryNavigationPage | null;
  user: { displayName: string; email?: string };
  isAdmin?: boolean;
  mapHref?: string;
  donateUrl?: string;
  adminUrl?: string;
  logoutUrl?: string;
  showFooter?: boolean;
  title?: string;
};

export type MapGroupOptionView = {
  id: string;
  name: string;
};

export type MapPageModel = AuthenticatedShellModel & {
  page: 'map';
  mode: 'personal' | 'following' | 'competitive';
  period: 'all-time' | 'current-month';
  defaultSort: 'distance' | 'latest';
  location: string | null;
  locationClearHref?: string;
  leaderboard: Array<{ rank: number; pilot: PilotView; cells: string; isCurrent: boolean }>;
  groupOptions: MapGroupOptionView[];
  selectedGroup: MapGroupOptionView | null;
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

export type GuestPlanShellModel = {
  page: 'plan';
  title: string;
  isGuest: true;
  showFooter: false;
};

export type PlanPageModel = (AuthenticatedShellModel & { isGuest?: false } | GuestPlanShellModel) & {
  page: 'plan';
  mapStyleUrl: string;
  thermalTileUrl: string;
  defaultRoutingPriority: 'shorter' | 'balanced' | 'thermal';
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
  key: 'profile' | 'first-flight' | 'personal-map' | 'follow-pilots' | 'competitive-map' | 'groups' | 'glider' | 'history';
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
  flights: FlightTableRowView[];
  personalRecords: PersonalRecordView[];
  recentAchievements: AchievementView[];
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
  groups: GroupMembershipView[];
  pendingGroupInvitations: GroupInvitationView[];
};

export type GroupMembershipView = {
  id: string;
  name: string;
  initials: string;
  href: string;
  rank: number | null;
  cells: string;
  fivePointDistance: string;
  isDistanceLeader: boolean;
  memberCount: string;
  isOwner: boolean;
};

export type GroupInvitationView = {
  groupId: string;
  groupName: string;
  ownerName: string;
  memberCount: string;
  acceptHref: string;
  declineHref: string;
};

export type GroupStandingView = {
  userId: string;
  displayName: string;
  initials: string;
  color: string;
  rank: number | null;
  cells: string;
  fivePointDistance: string;
  isDistanceLeader: boolean;
  isCurrent: boolean;
  filterHref?: string;
};

export type GroupFlightView = {
  id: string;
  pilotName: string;
  pilotInitials: string;
  pilotColor: string;
  launchTime: string;
  fivePointDistance: string;
  duration: string;
  thumbnail?: { wideUrl: string; squareUrl: string };
  detailHref: string;
  trackHref?: string;
  isSelected?: boolean;
};

export type GroupPageModel = AuthenticatedShellModel & {
  page: 'group';
  group: {
    id: string;
    name: string;
    initials: string;
    month: string;
    monthLabel: string;
    memberCount: string;
    capacity: string;
    isOwner: boolean;
    inviteHref?: string;
    settingsHref?: string;
    leaveHref?: string;
    deleteHref?: string;
    inviteSearchHref?: string;
    inviteSubmitHref?: string;
    members?: Array<{ userId: string; displayName: string; status: 'accepted' | 'pending'; removeHref?: string; cancelHref?: string }>;
  };
  standings: GroupStandingView[];
  flights: GroupFlightView[];
  mapStyleUrl?: string;
  tileUrl?: string;
  pilotColorsJson?: string;
  territoryTileMinimumZoom?: number;
  territoryTileMaximumZoom?: number;
  selectedPilotId?: string;
  selectedPilotName?: string;
  clearFilterHref?: string;
  selectedFlightId?: string;
  standingsLoadMoreHref?: string;
  flightsLoadMoreHref?: string;
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
    launchAltitude: string;
    minAltitude: string;
    maxAltitude: string;
    fivePointDistance: string;
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

export type AuthenticatedPageModel = MapPageModel | PlanPageModel | ActivityPageModel | AchievementsPageModel | ProfilePageModel | FlightPageModel | GroupPageModel;
