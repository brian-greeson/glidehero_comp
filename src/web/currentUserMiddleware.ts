import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser, AuthService } from '../services/authService.js';
import type { SessionCookie } from './sessionCookie.js';

declare global {
  namespace Express {
    interface Locals {
      currentUser: AuthenticatedUser | null;
      sessionToken: string | null;
    }
  }
}

export function createCurrentUserMiddleware(auth: AuthService, cookie: SessionCookie) {
  return async function currentUser(req: Request, res: Response, next: NextFunction) {
    try {
      const token = cookie.read(req.header('cookie'));
      res.locals.sessionToken = token;
      res.locals.currentUser = token ? await auth.authenticate(token) : null;
      next();
    } catch (error) {
      next(error);
    }
  };
}
