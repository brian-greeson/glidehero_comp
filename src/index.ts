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
import { createFlightUploadWorkflowService } from './services/flightUploadWorkflowService.js';
import { createFailedFlightCleanupService } from './services/failedFlightCleanupService.js';
import { createProfileService } from './services/profileService.js';
import { createMonthlyCoverageService } from './services/monthlyCoverageService.js';
import { createMapGridService } from './services/mapGridService.js';
import { createTerritoryTileService } from './services/territoryTileService.js';
import { createTerritoryTileSettingsService } from './services/territoryTileSettingsService.js';
import { createPageRenderer } from './views/renderer.js';
import {
  createAdminAreaPageRenderer,
  createAdminFlightProcessingPageRenderer,
  createAdminMapSettingsPageRenderer,
  createAdminPageRenderer,
  createAdminThermalPageRenderer,
  createAdminUserPageRenderer,
} from './views/admin/renderer.js';
import { createAuthenticatedActivityFeedRenderer, createAuthenticatedPageRenderer } from './views/authenticated/renderer.js';
import { createAdminAreaRouter } from './web/adminAreaRouter.js';
import { createAdminUserRouter } from './web/adminUserRouter.js';
import { createCurrentUserMiddleware } from './web/currentUserMiddleware.js';
import { createSessionCookie } from './web/sessionCookie.js';
import { createWebRouter } from './web/webRouter.js';
import { createDonationRouter } from './routes/donationRouter.js';
import { createDonationService } from './services/donationService.js';
import { createFollowService } from './services/followService.js';
import { createActivityService } from './services/activityService.js';
import { createFlightThumbnailService } from './services/flightThumbnailService.js';
import { createFlightThumbnailLifecycleService } from './services/flightThumbnailLifecycleService.js';
import { createFlightThumbnailDeliveryService } from './services/flightThumbnailDeliveryService.js';
import { createUserAchievementProgressService } from './services/userAchievementProgressService.js';
import { createUserArenaProgressService } from './services/userArenaProgressService.js';
import { createWorkerControlService } from './services/workerControlService.js';
import { createFlightProcessingControlService } from './services/flightProcessingControlService.js';
import { createUserHistoryRebuildService } from './services/userHistoryRebuildService.js';
import { createFlightDetailService } from './services/flightDetailService.js';
import { createMapReplayService } from './services/mapReplayService.js';
import { createCellFlightTrackService } from './services/cellFlightTrackService.js';
import { createOnboardingService } from './services/onboardingService.js';
import { createThermalKkClient } from './resources/thermalKkClient.js';
import { createThermalRasterCacheService } from './services/thermalRasterCacheService.js';
import { createPlanService } from './services/planService.js';
import { createThermalCrawlService } from './services/thermalCrawlService.js';
import { createAdminThermalRouter } from './web/adminThermalRouter.js';

const config = parseConfig(process.env);
const { db } = createDatabase(config.databaseUrl);
const donations = createDonationService(db);
const s3Client = createBucketClient(config);
const thermalKk = createThermalKkClient({ sourceHostname: config.thermalKkSourceHostname });
const thermalRasters = createThermalRasterCacheService(db, thermalKk, {
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const plans = createPlanService(db, { cellSize: config.gridClaimCellSize });
const thermalCrawl = createThermalCrawlService(db);
const thumbnails = createFlightThumbnailService({
  mapTilerCredentials: config.mapTilerCredentials,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
  cellSize: config.gridClaimCellSize,
  s3Client,
});
const thumbnailLifecycle = createFlightThumbnailLifecycleService(db, thumbnails, {
  cellSize: config.gridClaimCellSize,
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const thumbnailDelivery = createFlightThumbnailDeliveryService({
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const valkey = await createValkeyClient(config.valkeyUrl);
const workerControl = createWorkerControlService(valkey);
const flightProcessingControl = createFlightProcessingControlService(valkey);
const arenaLeadership = createArenaLeadershipReconciliationService(db, { cellSize: config.gridClaimCellSize });
const userAchievementProgress = createUserAchievementProgressService(db, { cellSize: config.gridClaimCellSize });
const userArenaProgress = createUserArenaProgressService(db, { cellSize: config.gridClaimCellSize });
const onboarding = createOnboardingService(db);
const auth = createAuthService(db, { sessionTtlSeconds: config.sessionTtlSeconds }, userAchievementProgress, onboarding);
const gridClaim = createGridClaimService(db, { cellSize: config.gridClaimCellSize }, undefined, undefined, arenaLeadership, userAchievementProgress, userArenaProgress);
const adminAreas = createAdminAreaService(db, { cellSize: config.gridClaimCellSize }, arenaLeadership, userArenaProgress, userAchievementProgress);
const arenas = createArenaService(db, { cellSize: config.gridClaimCellSize });
const arenaProgress = createArenaProgressService(db, { cellSize: config.gridClaimCellSize });
const monthlyCoverage = createMonthlyCoverageService(db, { cellSize: config.gridClaimCellSize });
const mapGrid = createMapGridService(db, { cellSize: config.gridClaimCellSize });
const territoryTiles = createTerritoryTileService(db, { cellSize: config.gridClaimCellSize });
const cellFlightTracks = createCellFlightTrackService(db, { cellSize: config.gridClaimCellSize });
const territoryTileSettings = createTerritoryTileSettingsService();
const profiles = createProfileService(db, {
  cellSize: config.gridClaimCellSize,
  userAchievementProgress,
});
const follow = createFollowService(db);
const activity = createActivityService(db);
const flightDetail = createFlightDetailService(db, { cellSize: config.gridClaimCellSize });
const mapReplay = createMapReplayService(db);
const uploadWorkflow = createFlightUploadWorkflowService(db);
const uploadQueue = createFlightUploadQueueService(valkey, {
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
  database: db,
  workflowService: uploadWorkflow,
});
const adminFlights = createAdminFlightService(db, gridClaim, {
  s3Client,
  bucketName: config.bucket.bucketName,
  uploadQueue,
  thumbnailLifecycle,
}, { arenaLeadership, cellSize: config.gridClaimCellSize, userAchievementProgress, userArenaProgress }, activity);
const adminUsers = createAdminUserService(db, {
  uploadQueue,
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
  arenaLeadership,
  cellSize: config.gridClaimCellSize,
  userAchievementProgress,
});
const userHistoryRebuild = createUserHistoryRebuildService(db, {
  cellSize: config.gridClaimCellSize,
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
    historyRebuild: userHistoryRebuild,
    renderPage: createAdminUserPageRenderer(),
  }),
  createAdminThermalRouter({
    adminEmails: config.adminEmails,
    crawl: thermalCrawl,
    renderPage: createAdminThermalPageRenderer({ mapTilerApiKey: config.mapTilerApiKey }),
  }),
  createWebRouter({
    auth,
    cookie,
    uploadQueue,
    uploadWorkflow,
    failedFlightCleanup,
    profiles,
    follow,
    activity,
    onboarding,
    plans,
    thermalRasters,
    flightDetail,
    mapReplay,
    gridClaim,
    mapGrid,
    coverage: monthlyCoverage,
    territoryTiles,
    cellFlightTracks,
    arenas,
    arenaProgress,
    renderPage: createPageRenderer({
      mapTilerApiKey: config.mapTilerApiKey,
      territoryTileSettings,
    }),
    renderAuthenticatedPage: createAuthenticatedPageRenderer(),
    renderAuthenticatedActivityFeed: createAuthenticatedActivityFeedRenderer(),
    mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${config.mapTilerApiKey}`,
    adminEmails: config.adminEmails,
    adminFlights,
    workerControl,
    flightProcessingControl,
    renderAdminPage: createAdminPageRenderer(),
    renderAdminFlightProcessingPage: createAdminFlightProcessingPageRenderer(),
    territoryTileSettings,
    renderAdminMapSettingsPage: createAdminMapSettingsPageRenderer(),
    thumbnailDelivery,
  }),
];
const server = createServer(createApp({ webMiddleware }));

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
