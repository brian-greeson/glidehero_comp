import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
import type { AdminFlight } from '../services/adminFlightService.js';
import type { ArenaDetail } from '../services/arenaService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
  page?: 'landing' | 'global' | 'personal' | 'arena' | 'notFound';
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
export type AdminPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  flights: AdminFlight[];
  reprocessSuccess?: boolean;
  reprocessError?: boolean;
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
      notFound: 'pages/notFound.vto',
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
        isNotFound: page === 'notFound',
        dashboardScript,
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
        ...model,
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
      isNotFound: false,
      dashboardScript: '',
      ...model,
    })
  ).content;
}
