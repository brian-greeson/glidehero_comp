import { createServer } from 'node:http';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createBucketClient } from './resources/bucketClient.js';
import { createValkeyClient } from './resources/valkeyClient.js';
import { createAuthService } from './services/authService.js';
import { createAdminFlightService } from './services/adminFlightService.js';
import { createAdminAreaService } from './services/adminAreaService.js';
import { createAdminUserService } from './services/adminUserService.js';
import { createArenaService } from './services/arenaService.js';
import { createArenaProgressService } from './services/arenaProgressService.js';
import { createGridClaimService } from './services/gridClaimService.js';
import { createArenaLeadershipReconciliationService } from './services/arenaLeadershipReconciliationService.js';
import { createFlightUploadQueueService } from './services/flightUploadQueueService.js';
import { createFailedFlightCleanupService } from './services/failedFlightCleanupService.js';
import { createProfileService } from './services/profileService.js';
import { createMonthlyCoverageService } from './services/monthlyCoverageService.js';
import { createMapGridService } from './services/mapGridService.js';
import { createTerritoryTileService } from './services/territoryTileService.js';
import { createTerritoryTileSettingsService } from './services/territoryTileSettingsService.js';
import { createAdminAreaPageRenderer, createAdminMapSettingsPageRenderer, createAdminPageRenderer, createAdminUserPageRenderer, createPageRenderer } from './views/renderer.js';
import { createAdminAreaRouter } from './web/adminAreaRouter.js';
import { createAdminUserRouter } from './web/adminUserRouter.js';
import { createCurrentUserMiddleware } from './web/currentUserMiddleware.js';
import { createSessionCookie } from './web/sessionCookie.js';
import { createWebRouter } from './web/webRouter.js';
import { createDonationRouter } from './routes/donationRouter.js';
import { createDonationService } from './services/donationService.js';

const config = parseConfig(process.env);
const { db } = createDatabase(config.databaseUrl);
const auth = createAuthService(db, { sessionTtlSeconds: config.sessionTtlSeconds });
const donations = createDonationService(db);
const s3Client = createBucketClient(config);
const valkey = await createValkeyClient(config.valkeyUrl);
const arenaLeadership = createArenaLeadershipReconciliationService(db, { cellSize: config.gridClaimCellSize });
const gridClaim = createGridClaimService(db, { cellSize: config.gridClaimCellSize }, undefined, undefined, arenaLeadership);
const adminAreas = createAdminAreaService(db, { cellSize: config.gridClaimCellSize }, arenaLeadership);
const arenas = createArenaService(db, { cellSize: config.gridClaimCellSize });
const arenaProgress = createArenaProgressService(db, { cellSize: config.gridClaimCellSize });
const monthlyCoverage = createMonthlyCoverageService(db, { cellSize: config.gridClaimCellSize });
const mapGrid = createMapGridService(db, { cellSize: config.gridClaimCellSize });
const territoryTiles = createTerritoryTileService(db, { cellSize: config.gridClaimCellSize });
const territoryTileSettings = createTerritoryTileSettingsService();
const profiles = createProfileService(db, { cellSize: config.gridClaimCellSize });
const uploadQueue = createFlightUploadQueueService(valkey, {
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const adminFlights = createAdminFlightService(db, gridClaim, {
  s3Client,
  bucketName: config.bucket.bucketName,
  uploadQueue,
}, { arenaLeadership, cellSize: config.gridClaimCellSize });
const adminUsers = createAdminUserService(db, {
  uploadQueue,
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const failedFlightCleanup = createFailedFlightCleanupService(db, uploadQueue, {
  s3Client,
  bucketName: config.bucket.bucketName,
});
const cookie = createSessionCookie({
  name: config.sessionCookieName,
  secure: config.isProduction,
  maxAgeSeconds: config.sessionTtlSeconds,
});
const webMiddleware = [
  createDonationRouter({ donations, verificationToken: config.kofiVerificationToken }),
  createCurrentUserMiddleware(auth, cookie),
  createAdminAreaRouter({
    adminEmails: config.adminEmails,
    areas: adminAreas,
    renderPage: createAdminAreaPageRenderer({ mapTilerApiKey: config.mapTilerApiKey }),
  }),
  createAdminUserRouter({
    adminEmails: config.adminEmails,
    users: adminUsers,
    flights: adminFlights,
    renderPage: createAdminUserPageRenderer(),
  }),
  createWebRouter({
    auth,
    cookie,
    uploadQueue,
    failedFlightCleanup,
    profiles,
    gridClaim,
    mapGrid,
    coverage: monthlyCoverage,
    territoryTiles,
    arenas,
    arenaProgress,
    renderPage: createPageRenderer({
      mapTilerApiKey: config.mapTilerApiKey,
      territoryTileSettings,
    }),
    adminEmails: config.adminEmails,
    adminFlights,
    renderAdminPage: createAdminPageRenderer(),
    territoryTileSettings,
    renderAdminMapSettingsPage: createAdminMapSettingsPageRenderer(),
  }),
];
const server = createServer(createApp({ webMiddleware }));

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
