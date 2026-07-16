import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
import type { AdminFlight } from '../services/adminFlightService.js';
import type { ArenaDetail } from '../services/arenaService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
  page?: 'landing' | 'global' | 'personal' | 'arena';
  arena?: ArenaDetail;
  loginError?: string;
  signupError?: string;
  loginEmail?: string;
  signupEmail?: string;
  signupDisplayName?: string;
  uploadError?: string;
  uploadSuccess?: boolean;
  territoryColorError?: string;
  territoryColorSuccess?: boolean;
  isAdmin?: boolean;
  isDashboard?: boolean;
};

export type PageRenderer = (model: PageModel) => Promise<string>;
export type ErrorPageRenderer = (model: {
  currentUser: AuthenticatedUser | null;
  status: number;
}) => Promise<string>;
export type AdminPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  flights: AdminFlight[];
  reprocessSuccess?: boolean;
  reprocessError?: boolean;
}) => Promise<string>;
export type AdminAreaPageRenderer = (model: {
  currentUser: AuthenticatedUser;
}) => Promise<string>;
export type CoveragePlaytestPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  page: 'coverage-global' | 'coverage-arena';
  arena?: ArenaDetail;
}) => Promise<string>;

function createEnvironment() {
  return vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
}

export function createPageRenderer(options: { mapTilerApiKey: string }): PageRenderer {
  const environment = createEnvironment();

  return async (model) => {
    const page = model.page ?? (model.currentUser ? 'global' : 'landing');
    const template = {
      landing: 'pages/index.vto',
      global: 'pages/global.vto',
      personal: 'pages/personal.vto',
      arena: 'pages/arena.vto',
    }[page];
    const dashboardScript = page === 'arena' ? '/scripts/arena.js' : '/scripts/dashboard.js';

    return (
      await environment.run(template, {
        loginError: undefined,
        signupError: undefined,
        loginEmail: '',
        signupEmail: '',
        signupDisplayName: '',
        uploadError: undefined,
        uploadSuccess: false,
        territoryColorError: undefined,
        territoryColorSuccess: false,
        isAdmin: false,
        arena: undefined,
        isDashboard: page === 'global' || page === 'personal' || page === 'arena',
        isErrorPage: false,
        dashboardScript,
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
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

export function createCoveragePlaytestPageRenderer(
  options: { mapTilerApiKey: string },
): CoveragePlaytestPageRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run(
      model.page === 'coverage-arena'
        ? 'pages/coveragePlaytestArena.vto'
        : 'pages/coveragePlaytestGlobal.vto',
      {
        arena: undefined,
        isDashboard: true,
        isErrorPage: false,
        dashboardScript: model.page === 'coverage-arena'
          ? '/scripts/coveragePlaytestArena.js'
          : '/scripts/coveragePlaytestGlobal.js',
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
        ...model,
      },
    )
  ).content;
}
