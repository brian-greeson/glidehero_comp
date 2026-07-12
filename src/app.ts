import express, { Request, Response, NextFunction } from 'express';
import { createV1Router } from './routes/routes.js';
import { config } from './config.js';

import { errorHandler } from './middleware/authMiddleware.js';
import { requestLogger } from './middleware/logMiddleware.js';
import { toolsRouter } from './routes/toolsRouter.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '256kb', type: 'application/json' }));
  app.use(requestLogger);
  if (!config.isProduction) {
    app.use(toolsRouter);
  }
  app.use('/v1', createV1Router());

  app.use(errorHandler);
  return app;
}
