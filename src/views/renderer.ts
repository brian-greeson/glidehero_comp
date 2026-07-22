import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
import type { AdminFlight } from '../services/adminFlightService.js';
import type { AdminUserFlight } from '../services/adminFlightService.js';
import type { AdminUserDetail, AdminUserSummary } from '../services/adminUserService.js';
import type { TerritoryTileConfig } from '../config/territoryTiles.js';
import { createTerritoryTileSettingsService, type TerritoryTileSettingsService } from '../services/territoryTileSettingsService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
  page?: 'landing';
  loginError?: string;
  signupError?: string;
  loginEmail?: string;
  signupEmail?: string;
  signupDisplayName?: string;
  territoryColorError?: string;
};

export type PageRenderer = (model: PageModel) => Promise<string>;
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
    return (
      await environment.run('pages/index.vto', {
        loginError: undefined,
        signupError: undefined,
        loginEmail: '',
        signupEmail: '',
        signupDisplayName: '',
        territoryColorError: undefined,
        territoryColorSuccess: false,
        isAdmin: false,
        currentPath: '/',
        isDashboard: false,
        isErrorPage: false,
        dashboardScript: '',
        pageStylesheet: undefined,
        pageScript: undefined,
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
        territoryTileConfig: territoryTileSettings.get(),
        ...model,
      })
    ).content;
  };
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
