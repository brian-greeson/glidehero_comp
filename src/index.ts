import { createServer } from 'node:http';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createBucketClient } from './resources/bucketClient.js';
import { createAuthService } from './services/authService.js';
import { createIgcFileService } from './services/igcFileService.js';
import { createProfileService } from './services/profileService.js';
import { createPageRenderer } from './views/renderer.js';
import { createCurrentUserMiddleware } from './web/currentUserMiddleware.js';
import { createSessionCookie } from './web/sessionCookie.js';
import { createWebRouter } from './web/webRouter.js';

const config = parseConfig(process.env);
const { db } = createDatabase(config.databaseUrl);
const auth = createAuthService(db, { sessionTtlSeconds: config.sessionTtlSeconds });
const igcFiles = createIgcFileService(db, {
  s3Client: createBucketClient(config),
  bucketName: config.bucket.bucketName,
});
const profiles = createProfileService(db);
const cookie = createSessionCookie({
  name: config.sessionCookieName,
  secure: config.isProduction,
  maxAgeSeconds: config.sessionTtlSeconds,
});
const webMiddleware = [
  createCurrentUserMiddleware(auth, cookie),
  createWebRouter({ auth, cookie, igcFiles, profiles, renderPage: createPageRenderer() }),
];
const server = createServer(createApp({ webMiddleware }));

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
