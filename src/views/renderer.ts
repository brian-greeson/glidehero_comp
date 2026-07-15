import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';
import type { AdminFlight } from '../services/adminFlightService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
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

  return async (model) =>
    (
      await environment.run('pages/index.vto', {
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
        isDashboard: true,
        mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
        ...model,
      })
    ).content;
}

export function createAdminPageRenderer(): AdminPageRenderer {
  const environment = createEnvironment();

  return async (model) => (
    await environment.run('pages/admin.vto', {
      reprocessSuccess: false,
      reprocessError: false,
      isDashboard: false,
      ...model,
    })
  ).content;
}
