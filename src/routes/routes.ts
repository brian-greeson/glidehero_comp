import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { ApiError } from '../domain/errors.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import authRouter from './authRouter.js';
import profileRouter from './profileRouter.js';
import gameRouter from './gameRouter.js';
import profileClaimRouter from './profileClaimRouter.js';
import feedRouter from './feedRouter.js';
import followRouter from './followRouter.js';
import swingRouter from './swingRouter.js';

export function createV1Router() {
  const router = Router();
  router.use(authRouter);

  router.use(requireAuth);
  router.use(profileRouter);
  router.use(profileClaimRouter);
  router.use(gameRouter);
  router.use(feedRouter);
  router.use(followRouter);
  router.use(swingRouter);

  return router;
}

// function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
//   return (req: Request, res: Response, next: NextFunction) => {
//     handler(req, res).catch(next);
//   };
// }

// function requiredParam(req: Request, name: string): string {
//   const value = req.params[name];
//   if (!value || Array.isArray(value)) {
//     throw new ApiError(422, "invalid_request", `Missing route parameter ${name}.`);
//   }
//   return value;
// }
