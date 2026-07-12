import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/v1/up', (_req, res) => {
  res.status(200).json({ ok: true, app: 'GlideHero' });
});
