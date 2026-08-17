import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
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
export type PlanNotFoundPageRenderer = (model: {
  currentUser: AuthenticatedUser | null;
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
          ? 'This route seems to be tangled in a tree. Don\'t worry, the arborist is on their way.'
          : 'Glide Hero hit an unexpected snag.  try launching again.',
        pageStylesheet: undefined,
        pageScript: undefined,
      })
    ).content;
  };
}

export function createPlanNotFoundPageRenderer(): PlanNotFoundPageRenderer {
  const environment = createEnvironment();

  return async ({ currentUser }) => (
    await environment.run('pages/error.vto', {
      currentUser,
      isDashboard: false,
      isErrorPage: true,
      errorStatus: 404,
      errorEyebrow: 'Plan unavailable',
      errorHeading: 'Plan not found.',
      errorMessage: 'This Plan could not be found or is unavailable.',
      pageStylesheet: undefined,
      pageScript: undefined,
    })
  ).content;
}
