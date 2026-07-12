import type { NextFunction, Request, Response } from 'express';
import { authenticateAccessToken, AuthUser } from '../services/authService.js';
import { ApiError, unauthorized } from '../domain/errors.js';
import { UserRow } from '../db/types.js';

export type AuthenticatedRequest = Request & {
  player: AuthUser
};

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
    if (!match?.[1]) {
      throw unauthorized();
    }

    (req as AuthenticatedRequest).player = await authenticateAccessToken(match[1]);
    next();
  } catch (error) {
    next(error);
  }
}

export function getAuth(req: Request): AuthUser {
  return (req as AuthenticatedRequest).player;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: {
      code: 'invalid_request',
      message: 'Internal server error.',
      details: null,
    },
  });
}
