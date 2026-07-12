import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { AppError } from './domain/errors.js';
import { requestLogger } from './middleware/logMiddleware.js';
import { healthRouter } from './routes/healthRouter.js';

export type AppDependencies = {
  webMiddleware?: RequestHandler[];
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(requestLogger);
  app.use(healthRouter);
  for (const middleware of dependencies.webMiddleware ?? []) app.use(middleware);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'server_error', message: 'Internal server error.' } });
  };
  app.use(errorHandler);
  return app;
}
