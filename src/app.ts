import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { AppError } from './domain/errors.js';
import { requestLogger } from './middleware/logMiddleware.js';
import { healthRouter } from './routes/healthRouter.js';
import { createErrorPageRenderer, type ErrorPageRenderer } from './views/renderer.js';

export type AppDependencies = {
  webMiddleware?: RequestHandler[];
  renderErrorPage?: ErrorPageRenderer;
};

function isApiRequest(req: Request): boolean {
  return req.path === '/v1'
    || req.path.startsWith('/v1/')
    || req.path.startsWith('/admin/api/')
    || req.path.startsWith('/donations/');
}

function errorStatus(error: unknown): number {
  if (error instanceof AppError && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  if (error && typeof error === 'object') {
    const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return 500;
}

const lastResortErrorPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GlideHero</title></head>
  <body><main><h1>We hit a little turbulence.</h1><p>Head home and try launching again.</p><a href="/">Head home</a></main></body>
</html>`;

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const renderErrorPage = dependencies.renderErrorPage ?? createErrorPageRenderer();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(requestLogger);
  app.use(healthRouter);
  app.use(express.static(resolve('public'), { fallthrough: true }));
  for (const middleware of dependencies.webMiddleware ?? []) app.use(middleware);

  const notFoundHandler: RequestHandler = async (req, res, next) => {
    if (isApiRequest(req)) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    try {
      res.status(404).type('html').send(await renderErrorPage({
        currentUser: res.locals.currentUser ?? null,
        status: 404,
      }));
    } catch (error) {
      next(error);
    }
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = async (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const status = errorStatus(error);
    const isDonationRequest = req.path.startsWith('/donations/');
    const isDonationParserError = isDonationRequest && status >= 400 && status < 500;
    if (!(error instanceof AppError) && !isDonationParserError) console.error(error);

    if (isApiRequest(req)) {
      if (error instanceof AppError || (isDonationRequest && status !== 500)) {
        const code = error instanceof AppError ? error.code : 'invalid_request';
        const message = error instanceof AppError ? error.message : 'Invalid request.';
        res.status(status).json({ error: { code, message } });
        return;
      }
      res.status(500).json({ error: { code: 'server_error', message: 'Internal server error.' } });
      return;
    }

    try {
      res.status(status).type('html').send(await renderErrorPage({
        currentUser: res.locals.currentUser ?? null,
        status,
      }));
    } catch (renderError) {
      console.error('Unable to render error page', renderError);
      res.status(status).type('html').send(lastResortErrorPage);
    }
  };
  app.use(errorHandler);
  return app;
}
