import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';

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
};

export type PageRenderer = (model: PageModel) => Promise<string>;

export function createPageRenderer(): PageRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });

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
        ...model,
      })
    ).content;
}
