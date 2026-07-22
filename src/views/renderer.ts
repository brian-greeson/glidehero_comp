import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
import type { AdminFlight } from '../services/adminFlightService.js';
import type { AdminUserFlight } from '../services/adminFlightService.js';
import type { AdminUserDetail, AdminUserSummary } from '../services/adminUserService.js';
import type { ArenaDetail } from '../services/arenaService.js';
import type { ArenaPersonalProgress } from '../services/arenaProgressService.js';
import type { TerritoryTileConfig } from '../config/territoryTiles.js';
import type { AchievementProgressCard, PilotProfileSummary } from '../services/profileService.js';
import type { PilotSearchResult } from '../services/followService.js';
import type { ActivityFeedItem } from '../services/activityService.js';
import { createTerritoryTileSettingsService, type TerritoryTileSettingsService } from '../services/territoryTileSettingsService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
  page?: 'landing' | 'global' | 'personal' | 'arena' | 'profile' | 'activity';
  arena?: ArenaDetail;
  arenaProgress?: ArenaPersonalProgress;
  profile?: PilotProfileSummary;
  dashboardAchievementProgress?: AchievementProgressCard[];
  profileIsCurrent?: boolean;
  profileIsFollowed?: boolean;
  activitySearch?: string;
  activityPilotResults?: PilotSearchResult[];
  activityReturnTo?: string;
  activityFeed?: ActivityFeedItem[];
  activityNextCursor?: string | null;
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
  currentPath?: string;
  loginError?: string;
  signupError?: string;
  loginEmail?: string;
  signupEmail?: string;
  signupDisplayName?: string;
  territoryColorError?: string;
  territoryColorSuccess?: boolean;
  isAdmin?: boolean;
  isDashboard?: boolean;
};

export type PageRenderer = (model: PageModel) => Promise<string>;
export type ActivityFeedRenderer = (model: {
  activityFeed: ActivityFeedItem[];
  activityNextCursor: string | null;
  activitySearch?: string;
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
}) => Promise<string>;
export type ErrorPageRenderer = (model: {
  currentUser: AuthenticatedUser | null;
  status: number;
}) => Promise<string>;
export type AdminPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  flights: AdminFlight[];
  queueSummary?: { queued: number; processing: number; failed: number; oldestQueuedAgeSeconds: number | null };
  reprocessSuccess?: boolean;
  reprocessError?: boolean;
}) => Promise<string>;
export type AdminAreaPageRenderer = (model: {
  currentUser: AuthenticatedUser;
}) => Promise<string>;
export type AdminMapSettingsPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  settings: TerritoryTileConfig;
  saveSuccess?: boolean;
  saveError?: boolean;
}) => Promise<string>;
export type AdminUserPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  users: AdminUserSummary[];
  selectedUser?: AdminUserDetail;
  flights: AdminUserFlight[];
  deletableFlightCount: number;
  search: string;
  searchParam: string;
  mode: 'empty' | 'create' | 'edit';
  successMessage?: string;
  errorMessage?: string;
}) => Promise<string>;

function createEnvironment() {
  return vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
}

export function createPageRenderer(options: {
  mapTilerApiKey: string;
  territoryTileSettings?: TerritoryTileSettingsService;
}): PageRenderer {
  const environment = createEnvironment();
  const territoryTileSettings = options.territoryTileSettings ?? createTerritoryTileSettingsService();

  return async (model) => {
    const page = model.page ?? (model.currentUser ? 'personal' : 'landing');
    const template = {
      landing: 'pages/index.vto',
      global: 'pages/global.vto',
      personal: 'pages/personal.vto',
      arena: 'pages/arena.vto',
      profile: 'pages/profile.vto',
      activity: 'pages/activity.vto',
    }[page];
    const dashboardScript = page === 'arena' ? '/scripts/arena.js' : '/scripts/dashboard.js';

    return (
      await environment.run(template, {
        loginError: undefined,
        signupError: undefined,
        loginEmail: '',
        signupEmail: '',
        signupDisplayName: '',
        territoryColorError: undefined,
        territoryColorSuccess: false,
        isAdmin: false,
        arena: undefined,
        arenaProgress: undefined,
        profile: undefined,
        dashboardAchievementProgress: [],
        profileIsCurrent: false,
        profileIsFollowed: false,
        activitySearch: '',
        activityPilotResults: [],
        activityReturnTo: '/activity',
        activityFeed: [],
        activityNextCursor: null,
        activityLoadMoreHref: '',
        activityLoadMoreEndpoint: '',
        currentPath: '/',
        isDashboard: page === 'global' || page === 'personal' || page === 'arena',
        isErrorPage: false,
        dashboardScript,
        pageStylesheet: page === 'profile' ? '/styles/profile.css' : page === 'activity' ? '/styles/activity.css' : undefined,
        pageScript: page === 'profile' ? '/scripts/profile.js' : page === 'activity' ? '/scripts/activity.js' : undefined,
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
        territoryTileConfig: territoryTileSettings.get(),
        ...model,
      })
    ).content;
  };
}

export function createActivityFeedRenderer(): ActivityFeedRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run('components/activityFeedList.vto', {
      ...model,
      activitySearch: model.activitySearch ?? '',
      activityLoadMoreHref: model.activityLoadMoreHref ?? '',
      activityLoadMoreEndpoint: model.activityLoadMoreEndpoint ?? '',
    })
  ).content;
}

export function createErrorPageRenderer(): ErrorPageRenderer {
  const environment = createEnvironment();

  return async ({ currentUser, status }) => {
    const isNotFound = status === 404;
    return (
      await environment.run('pages/error.vto', {
        currentUser,
        isDashboard: false,
        isErrorPage: true,
        errorStatus: status,
        errorEyebrow: isNotFound ? 'A little off course' : 'A rough landing',
        errorHeading: isNotFound
          ? 'Well\u2026 that landing could have gone better.'
          : 'We hit a little turbulence.',
        errorMessage: isNotFound
          ? 'This route seems to be tangled in a tree. Let\u2019s pack up and head home.'
          : 'Glide Hero hit an unexpected snag. Pack up, head home, and try launching again.',
        pageStylesheet: undefined,
        pageScript: undefined,
      })
    ).content;
  };
}

export function createAdminPageRenderer(): AdminPageRenderer {
  const environment = createEnvironment();

  return async (model) => (
    await environment.run('pages/admin.vto', {
      reprocessSuccess: false,
      reprocessError: false,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: undefined,
      pageScript: undefined,
      queueSummary: undefined,
      ...model,
    })
  ).content;
}

export function createAdminMapSettingsPageRenderer(): AdminMapSettingsPageRenderer {
  const environment = createEnvironment();

  return async (model) => (
    await environment.run('pages/adminMapSettings.vto', {
      saveSuccess: false,
      saveError: false,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: undefined,
      pageScript: undefined,
      ...model,
    })
  ).content;
}

export function createAdminUserPageRenderer(): AdminUserPageRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run('pages/adminUsers.vto', {
      selectedUser: undefined,
      successMessage: undefined,
      errorMessage: undefined,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: '/styles/adminUserManagement.css',
      pageScript: '/scripts/admin/userManagement.js',
      ...model,
    })
  ).content;
}

export function createAdminAreaPageRenderer(options: { mapTilerApiKey: string }): AdminAreaPageRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run('pages/adminAreas.vto', {
      mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
      ...model,
    })
  ).content;
}
