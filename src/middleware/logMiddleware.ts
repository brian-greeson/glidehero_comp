import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
let logEnabled = true;
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  if (!config.isProduction || logEnabled) {
    console.log(req.body);
  }
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
};
