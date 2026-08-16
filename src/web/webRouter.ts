import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import { AppError } from '../domain/errors.js';
import { AuthFailure, type AuthenticatedUser, type AuthService } from '../services/authService.js';
import type { MonthlyCoveragePeriod, MonthlyCoverageService } from '../services/monthlyCoverageService.js';
import type { MapGridService } from '../services/mapGridService.js';
import { GliderValidationError, normalizeTerritoryColor, type ProfileService } from '../services/profileService.js';
import type { GridClaimService } from '../services/gridClaimService.js';
import type { AdminFlightService } from '../services/adminFlightService.js';
import type { ArenaService } from '../services/arenaService.js';
import type { ArenaProgressService } from '../services/arenaProgressService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
import type {
  AdminFlightProcessingPageRenderer,
  AdminMapSettingsPageRenderer,
  AdminPageRenderer,
} from '../views/admin/renderer.js';
import type { AuthenticatedActivityFeedRenderer, AuthenticatedPageRenderer } from '../views/authenticated/renderer.js';
import { createAuthenticatedShellModel, initialsForDisplayName } from '../views/authenticated/adapters/shellModel.js';
import { activityFeedToViews, activityPilotResultToView, activityStatsToView } from '../views/authenticated/adapters/activityView.js';
import { createAchievementsPageModel } from '../views/authenticated/adapters/achievementView.js';
import { pilotProfileToView } from '../views/authenticated/adapters/profileView.js';
import { createMapPageModel } from '../views/authenticated/adapters/mapView.js';
import type { AuthenticatedPageModel } from '../views/authenticated/models.js';
import type { FlightUploadQueueService } from '../services/flightUploadQueueService.js';
import type { FlightUploadWorkflowService } from '../services/flightUploadWorkflowService.js';
import type { FailedFlightCleanupService } from '../services/failedFlightCleanupService.js';
import type { TerritoryTileService } from '../services/territoryTileService.js';
import {
  createTerritoryTileSettingsService,
  MAXIMUM_TERRITORY_TILE_ZOOM,
  MINIMUM_TERRITORY_TILE_ZOOM,
  type TerritoryTileSettingsService,
} from '../services/territoryTileSettingsService.js';
import type { SessionCookie } from './sessionCookie.js';
import { PilotNotFoundError, type FollowService } from '../services/followService.js';
import type { ActivityService, ActivityStatistics } from '../services/activityService.js';
import { ActivityCursorError, ActivityNotFoundError, SelfLikeError } from '../services/activityService.js';
import type { FlightThumbnailDeliveryService } from '../services/flightThumbnailDeliveryService.js';
import { WORKER_STATUS_TTL_SECONDS, type WorkerControlService } from '../services/workerControlService.js';
import type { FlightProcessingControlService } from '../services/flightProcessingControlService.js';
import type { FlightDetailService } from '../services/flightDetailService.js';
import { createFlightMapPayload, createFlightPageView, createFlightSocialPreview, createPublicFlightPageView } from '../views/authenticated/adapters/flightDetailView.js';
import type { PublicFlightPageRenderer } from '../views/publicFlight/renderer.js';
import type { CellFlightTrackService } from '../services/cellFlightTrackService.js';
import type { MapReplayService } from '../services/mapReplayService.js';
import { FlightMapInputError, type FlightMapService } from '../services/flightMapService.js';
import type { OnboardingService, OnboardingStepKey } from '../services/onboardingService.js';
import { GroupError, type GroupService } from '../services/groupService.js';
import { createOnboardingView } from '../views/authenticated/adapters/onboardingView.js';
import type { PlanService } from '../services/planService.js';
import type { PlanExportService } from '../services/planExportService.js';
import type { ThermalRasterCacheService } from '../services/thermalRasterCacheService.js';
import type { LaunchMapService } from '../services/launchMapService.js';
import { THERMAL_NATIVE_ZOOM, xyzYToTmsY } from '../domain/thermal/thermalTiles.js';
import { flightMapListPageToPayload } from '../views/authenticated/adapters/flightMapView.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(3).max(128);
const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(48).optional().or(z.literal('')),
});
const loginSchema = z.object({ email, password });
const competitionMonthValue = z.string().refine((value) => {
  try {
    normalizeCompetitionLeaderboardMonth(value);
    return true;
  } catch {
    return false;
  }
});
const currentGroupMonthValue = competitionMonthValue.refine((value) => value === currentCompetitionMonth(), {
  message: 'Groups are available for the current month only.',
});
const competitionMonthSchema = z.object({ month: competitionMonthValue.optional(), scope: z.literal('following').optional() }).strict();
const personalPeriodSchema = z.object({ month: competitionMonthValue.optional() }).strict();
const pilotUserIdSchema = z.string().uuid();
const thermalTileCoordinateSchema = z.coerce.number().int().nonnegative();
const planRouteSchema = z.object({
  anchors: z.array(z.object({
    latitude: z.number().finite().min(-85).max(85),
    longitude: z.number().finite().min(-180).max(180),
  }).strict()).min(2).max(24),
  routingPriority: z.enum(['shorter', 'balanced', 'thermal']),
}).strict();
const planExportSchema = z.object({
  variant: z.enum(['main-turnpoints', 'optimized-track']),
  format: z.enum(['cup', 'tsk', 'wpt', 'xctsk']),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/),
  exportToken: z.string().uuid(),
}).strict();
const onboardingStepSchema = z.enum(['profile', 'first-flight', 'personal-map', 'follow-pilots', 'competitive-map', 'groups', 'glider', 'history']);
const activityQuerySchema = z.object({
  q: z.string().max(100).optional(),
  before: z.string().min(1).optional(),
  scope: z.enum(['following', 'yours']).optional(),
  onboardingStep: onboardingStepSchema.optional(),
  onboardingDismissed: z.literal('1').optional(),
}).strict();
const emptyActivityStatistics: ActivityStatistics = {
  daily: {
    flightCount: 0,
    mostAccomplishments: null,
    mostCells: null,
    greatestFivePointDistance: null,
  },
  monthly: {
    flightCount: 0,
    mostAccomplishments: null,
    mostCells: null,
    greatestFivePointDistance: null,
  },
};
const finiteCoordinate = z.string().refine(
  (value) => value.length > 0 && value.trim() === value && Number.isFinite(Number(value)),
).transform(Number);
const viewportBoundsShape = {
  west: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  south: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
  east: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  north: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
};
const viewportBoundsSchema = z.object(viewportBoundsShape)
  .strict()
  .refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const launchOptionsQuerySchema = z.union([
  viewportBoundsSchema,
  z.object({ q: z.string().trim().min(2).max(100) }).strict(),
]);
const flightMapScopeSchema = z.enum(['personal', 'following', 'all']);
const flightMapPeriodSchema = z.enum(['day', 'month', 'year', 'custom', 'all-time']);
const flightMapAnchorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const flightMapFilterShape = {
  scope: flightMapScopeSchema,
  period: flightMapPeriodSchema,
  anchor: flightMapAnchorSchema.optional(),
  start: flightMapAnchorSchema.optional(),
  end: flightMapAnchorSchema.optional(),
  launch: z.union([z.literal('unknown'), z.coerce.number().int().positive()]).optional(),
};
function isValidFlightMapDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function refineFlightMapDates(value: { scope?: string; period: string; anchor?: string; start?: string; end?: string }, context: z.RefinementCtx) {
  if (value.scope === 'personal' && value.period === 'day') context.addIssue({ code: 'custom', message: 'Personal history does not support a day period.' });
  for (const dateValue of [value.anchor, value.start, value.end]) {
    if (dateValue !== undefined && !isValidFlightMapDate(dateValue)) context.addIssue({ code: 'custom', message: 'Flight map date is invalid.' });
  }
  if (value.period === 'all-time') {
    if (value.anchor !== undefined || value.start !== undefined || value.end !== undefined) context.addIssue({ code: 'custom', message: 'All-time does not accept date values.' });
    return;
  }
  if (value.period === 'custom') {
    if (value.anchor !== undefined || value.start === undefined || value.end === undefined || value.start > value.end) context.addIssue({ code: 'custom', message: 'Custom range is invalid.' });
    return;
  }
  if (value.anchor === undefined || value.start !== undefined || value.end !== undefined) context.addIssue({ code: 'custom', message: 'Flight map period anchor is invalid.' });
}
const flightMapTrackQuerySchema = z.object({
  ...flightMapFilterShape,
  ...viewportBoundsShape,
  zoom: z.coerce.number().finite().min(0).max(24),
}).strict().superRefine((value, context) => {
  refineFlightMapDates(value, context);
  if (value.south >= value.north || value.west === value.east) {
    context.addIssue({ code: 'custom', message: 'Flight map viewport is invalid.' });
  }
});
const flightMapListQuerySchema = z.object({
  ...flightMapFilterShape,
  geography: z.enum(['global', 'map-area']),
  sort: z.enum(['distance', 'latest', 'duration']),
  cursor: z.string().min(1).optional(),
  west: finiteCoordinate.optional(),
  south: finiteCoordinate.optional(),
  east: finiteCoordinate.optional(),
  north: finiteCoordinate.optional(),
}).strict().superRefine((value, context) => {
  refineFlightMapDates(value, context);
  const coordinates = [value.west, value.south, value.east, value.north];
  const present = coordinates.filter((coordinate) => coordinate !== undefined).length;
  if ((value.geography === 'map-area' && present !== 4) || (value.geography === 'global' && present !== 0)) {
    context.addIssue({ code: 'custom', message: 'Flight map geography bounds are invalid.' });
  }
  if (present === 4 && (
    value.west! < -180 || value.west! > 180 || value.east! < -180 || value.east! > 180
    || value.south! < -90 || value.south! > 90 || value.north! < -90 || value.north! > 90
    || value.south! >= value.north! || value.west === value.east
  )) context.addIssue({ code: 'custom', message: 'Flight map viewport is invalid.' });
});
const personalHistoryQuerySchema = z.object({
  ...flightMapFilterShape,
  geography: z.enum(['global', 'map-area']),
  west: finiteCoordinate.optional(),
  south: finiteCoordinate.optional(),
  east: finiteCoordinate.optional(),
  north: finiteCoordinate.optional(),
}).strict().superRefine((value, context) => {
  refineFlightMapDates(value, context);
  if (value.scope !== 'personal') context.addIssue({ code: 'custom', message: 'Personal history requires personal scope.' });
  const coordinates = [value.west, value.south, value.east, value.north];
  const present = coordinates.filter((coordinate) => coordinate !== undefined).length;
  if ((value.geography === 'map-area' && present !== 4) || (value.geography === 'global' && present !== 0)) context.addIssue({ code: 'custom', message: 'Flight map geography bounds are invalid.' });
  if (present === 4 && (
    value.west! < -180 || value.west! > 180 || value.east! < -180 || value.east! > 180
    || value.south! < -90 || value.south! > 90 || value.north! < -90 || value.north! > 90
    || value.south! >= value.north! || value.west === value.east
  )) context.addIssue({ code: 'custom', message: 'Flight map viewport is invalid.' });
});
const flightMapSelectionQuerySchema = z.object({
  ...flightMapFilterShape,
  geography: z.enum(['global', 'map-area']),
  west: finiteCoordinate.optional(), south: finiteCoordinate.optional(), east: finiteCoordinate.optional(), north: finiteCoordinate.optional(),
}).strict().superRefine((value, context) => {
  refineFlightMapDates(value, context);
  const coordinates = [value.west, value.south, value.east, value.north];
  const present = coordinates.filter((coordinate) => coordinate !== undefined).length;
  if ((value.geography === 'map-area' && present !== 4) || (value.geography === 'global' && present !== 0)) context.addIssue({ code: 'custom', message: 'Flight map geography bounds are invalid.' });
  if (present === 4 && (value.south! >= value.north! || value.west === value.east)) context.addIssue({ code: 'custom', message: 'Flight map viewport is invalid.' });
});
const competitionLeaderboardSchema = z.object({
  month: competitionMonthValue.optional(),
  scope: z.literal('following').optional(),
  ...viewportBoundsShape,
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const arenaSearchSchema = z.object({ q: z.string().trim().min(1).max(100) }).strict();
const arenaSourceIdSchema = z.coerce.number().int().positive().safe();
const cellCoordinateSchema = z.coerce.number().int().safe();
const tileQuerySchema = z.object({
  month: competitionMonthValue.optional(),
  pilot: z.string().uuid().optional(),
  scope: z.literal('following').optional(),
}).strict();
const groupIdSchema = z.string().uuid();
const groupNameSchema = z.string().trim().min(1).max(80);
const groupMonthQuerySchema = z.object({
  month: currentGroupMonthValue.optional(),
  pilot: pilotUserIdSchema.optional(),
  flight: z.string().uuid().optional(),
}).strict();
const groupTileQuerySchema = z.object({
  month: currentGroupMonthValue,
  pilot: pilotUserIdSchema.optional(),
}).strict();
const territoryTileZoomSchema = z.string().trim().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(MINIMUM_TERRITORY_TILE_ZOOM).max(MAXIMUM_TERRITORY_TILE_ZOOM));
const territoryTileSettingsSchema = z.object({
  personalMinimumZoom: territoryTileZoomSchema,
  personalMaximumZoom: territoryTileZoomSchema,
  competitionMinimumZoom: territoryTileZoomSchema,
  competitionMaximumZoom: territoryTileZoomSchema,
}).strict()
  .refine((settings) => settings.personalMinimumZoom <= settings.personalMaximumZoom)
  .refine((settings) => settings.competitionMinimumZoom <= settings.competitionMaximumZoom);

function territoryTileCoordinates(
  zoom: { minimumZoom: number; maximumZoom: number },
  params: Record<string, string>,
) {
  const parsed = z.object({
    z: z.coerce.number().int().min(zoom.minimumZoom).max(zoom.maximumZoom),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  }).safeParse(params);
  if (!parsed.success) return null;
  const tileCount = 2 ** parsed.data.z;
  return parsed.data.x < tileCount && parsed.data.y < tileCount ? parsed.data : null;
}

function coveragePeriod(month?: string): MonthlyCoveragePeriod {
  return month ? { competitionMonth: month } : { period: 'all-time' };
}

function currentCompetitionMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function groupErrorToAppError(error: GroupError): AppError {
  const status = error.code === 'not_found' ? 404
    : error.code === 'forbidden' ? 403
      : error.code === 'conflict' ? 409
        : 422;
  return new AppError(status, error.code === 'validation' ? 'invalid_request' : error.code, error.message);
}

function formatGroupDistance(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? '—'
    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
}

function formatGroupDuration(value: unknown): string {
  if (!Number.isFinite(Number(value))) return '—';
  const seconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function formatGroupMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatGroupLaunchTime(value: Date | string, timeZone: string | null): string {
  const startedAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(startedAt.getTime())) return 'Launch time unavailable';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: timeZone || 'UTC',
    }).format(startedAt);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }).format(startedAt);
  }
}

function mapPagePeriod(query: Request['query'], options: { allowDay?: boolean } = {}): {
  period: 'all-time' | 'current-month';
  month?: string;
  suffix: string;
} {
  const rawMonth = query.month;
  const rawPeriod = query.period;
  const rawAnchor = query.anchor;
  const rawStart = query.start;
  const rawEnd = query.end;
  if (
    (rawMonth !== undefined && typeof rawMonth !== 'string')
    || (rawPeriod !== undefined && (typeof rawPeriod !== 'string' || !['day', 'month', 'year', 'custom', 'all-time'].includes(rawPeriod)))
    || (rawAnchor !== undefined && typeof rawAnchor !== 'string')
    || (rawStart !== undefined && typeof rawStart !== 'string')
    || (rawEnd !== undefined && typeof rawEnd !== 'string')
    || (rawMonth !== undefined && (rawPeriod !== undefined || rawAnchor !== undefined || rawStart !== undefined || rawEnd !== undefined))
  ) {
    throw new AppError(400, 'invalid_request', 'Map period is invalid.');
  }
  if (typeof rawMonth === 'string') {
    normalizeCompetitionLeaderboardMonth(rawMonth);
    return {
      period: 'current-month',
      month: rawMonth,
      suffix: `?month=${encodeURIComponent(rawMonth)}`,
    };
  }
  if (rawPeriod === 'all-time') {
    if (rawAnchor !== undefined || rawStart !== undefined || rawEnd !== undefined) throw new AppError(400, 'invalid_request', 'Map period is invalid.');
    return { period: 'all-time', suffix: '?period=all-time' };
  }
  if (rawPeriod === 'day' || rawPeriod === 'month' || rawPeriod === 'year') {
    if (rawPeriod === 'day' && options.allowDay === false) throw new AppError(400, 'invalid_request', 'Map period is invalid.');
    const parsedAnchor = flightMapAnchorSchema.safeParse(rawAnchor);
    if (!parsedAnchor.success || rawStart !== undefined || rawEnd !== undefined) throw new AppError(400, 'invalid_request', 'Map period is invalid.');
    const parsedDate = new Date(`${parsedAnchor.data}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== parsedAnchor.data) {
      throw new AppError(400, 'invalid_request', 'Map period is invalid.');
    }
    return {
      period: 'current-month',
      suffix: `?period=${rawPeriod}&anchor=${encodeURIComponent(parsedAnchor.data)}`,
    };
  }
  if (rawPeriod === 'custom') {
    const start = flightMapAnchorSchema.safeParse(rawStart);
    const end = flightMapAnchorSchema.safeParse(rawEnd);
    if (!start.success || !end.success || !isValidFlightMapDate(start.data) || !isValidFlightMapDate(end.data) || rawAnchor !== undefined || start.data > end.data) throw new AppError(400, 'invalid_request', 'Map period is invalid.');
    return { period: 'current-month', suffix: `?period=custom&start=${encodeURIComponent(start.data)}&end=${encodeURIComponent(end.data)}` };
  }
  if (rawAnchor !== undefined || rawStart !== undefined || rawEnd !== undefined) throw new AppError(400, 'invalid_request', 'Map period is invalid.');
  return { period: 'current-month', suffix: '' };
}

const uploadIntentSchema = z.object({
  originalFilename: z.string().min(1).max(255),
  contentType: z.string().max(255).default('application/octet-stream'),
  byteSize: z.number().int().positive(),
  batchId: z.string().uuid().optional(),
  historyImportId: z.string().uuid().optional(),
}).strict().refine((value) => Boolean(value.batchId) !== Boolean(value.historyImportId));

function formBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

async function render(res: Response, renderPage: PageRenderer, status: number, model: PageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

async function renderAuthenticated(res: Response, renderPage: AuthenticatedPageRenderer, status: number, model: AuthenticatedPageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

async function renderPublicFlight(res: Response, renderPage: PublicFlightPageRenderer, status: number, model: Parameters<PublicFlightPageRenderer>[0]) {
  res.status(status).type('html').send(await renderPage(model));
}

export function createWebRouter(dependencies: {
  auth: AuthService;
  cookie: SessionCookie;
  uploadQueue?: FlightUploadQueueService;
  uploadWorkflow?: FlightUploadWorkflowService;
  failedFlightCleanup?: FailedFlightCleanupService;
  profiles: ProfileService;
  follow?: FollowService;
  activity?: ActivityService;
  gridClaim: GridClaimService;
  mapGrid: MapGridService;
  coverage: MonthlyCoverageService;
  territoryTiles: TerritoryTileService;
  arenas: ArenaService;
  arenaProgress: ArenaProgressService;
  renderPage: PageRenderer;
  renderAuthenticatedPage: AuthenticatedPageRenderer;
  renderAuthenticatedActivityFeed: AuthenticatedActivityFeedRenderer;
  renderPublicFlightPage?: PublicFlightPageRenderer;
  publicOrigin?: string;
  mapTilerStyleUrl?: string;
  adminEmails?: readonly string[];
  adminFlights?: AdminFlightService;
  workerControl?: WorkerControlService;
  flightProcessingControl?: FlightProcessingControlService;
  renderAdminPage?: AdminPageRenderer;
  renderAdminFlightProcessingPage?: AdminFlightProcessingPageRenderer;
  territoryTileSettings?: TerritoryTileSettingsService;
  renderAdminMapSettingsPage?: AdminMapSettingsPageRenderer;
  thumbnailDelivery?: FlightThumbnailDeliveryService;
  flightDetail?: FlightDetailService;
  cellFlightTracks?: CellFlightTrackService;
  mapReplay?: MapReplayService;
  flightMap?: FlightMapService;
  launchMap?: LaunchMapService;
  onboarding?: OnboardingService;
  groups?: GroupService;
  plans?: PlanService;
  planExports?: PlanExportService;
  thermalRasters?: ThermalRasterCacheService;
}) {
  const router = Router();
  const territoryTileSettings = dependencies.territoryTileSettings ?? createTerritoryTileSettingsService();
  const adminEmails = new Set((dependencies.adminEmails ?? []).map((email) => email.trim().toLowerCase()));
  const isAdmin = (email: string) => adminEmails.has(email.trim().toLowerCase());

  async function activateNextRegular(userId: string) {
    if (!dependencies.uploadWorkflow || !dependencies.uploadQueue) return null;
    const member = await dependencies.uploadWorkflow.claimNextRegular(userId);
    if (member?.uploadJobId) {
      try {
        const activated = await dependencies.uploadQueue.activateJob(member.uploadJobId, member.id);
        const job = activated ? null : await dependencies.uploadQueue.getJob(member.uploadJobId);
        if (!activated && !job?.activatedAt) await dependencies.uploadWorkflow.releaseRegularClaim(member.id);
      } catch (error) {
        await dependencies.uploadWorkflow.releaseRegularClaim(member.id);
        throw error;
      }
    }
    return member;
  }

  async function activateNextBulk(importId: string, userId: string) {
    if (!dependencies.uploadWorkflow || !dependencies.uploadQueue) return null;
    const member = await dependencies.uploadWorkflow.claimNextBulk(importId, userId);
    if (member?.uploadJobId) {
      try {
        const activated = await dependencies.uploadQueue.activateJob(member.uploadJobId, member.id);
        const job = activated ? null : await dependencies.uploadQueue.getJob(member.uploadJobId);
        if (!activated && !job?.activatedAt) await dependencies.uploadWorkflow.releaseBulkClaim(member.id);
      } catch (error) {
        await dependencies.uploadWorkflow.releaseBulkClaim(member.id);
        throw error;
      }
    }
    return member;
  }

  async function renderCurrentProfile(
    res: Response,
    currentUser: AuthenticatedUser,
    status: number,
    gliderEditor?: {
      modelId: string;
      manufacturer: string;
      model: string;
      size: string;
      year: string;
      competitionId: string;
      hours: string;
      error: string;
      isOpen: boolean;
    },
  ) {
    const [profile, groupProfile] = await Promise.all([
      dependencies.profiles.getPilotProfile(currentUser.userId),
      dependencies.groups?.getProfileGroups(currentUser.userId, currentCompetitionMonth()),
    ]);
    if (!profile) return false;
    const thumbnailUrls = dependencies.thumbnailDelivery
      ? await dependencies.thumbnailDelivery.signMany(profile.recentFlights.map((flight) => ({ userId: profile.userId, flightId: flight.flightId })))
      : undefined;
    const shell = authenticatedShell('profile', currentUser);
    const view = pilotProfileToView(profile, { isCurrent: true, isFollowed: false, currentPath: '/profile', thumbnailUrls });
    const groups = (groupProfile?.groups ?? []).map((group) => ({
      id: group.groupId,
      name: group.name,
      initials: initialsForDisplayName(group.name),
      href: `/groups/${group.groupId}`,
      rank: group.rank,
      cells: String(group.claimedCellCount),
      fivePointDistance: formatGroupDistance(group.bestFivePointDistanceMeters),
      isDistanceLeader: group.trophy,
      memberCount: String(group.memberCount),
      isOwner: group.ownerUserId === currentUser.userId,
    }));
    const pendingGroupInvitations = (groupProfile?.invitations ?? []).map((invitation) => ({
      groupId: invitation.groupId,
      groupName: invitation.name,
      ownerName: invitation.ownerDisplayName,
      memberCount: String(invitation.memberCount),
      acceptHref: `/groups/${invitation.groupId}/invitations/accept`,
      declineHref: `/groups/${invitation.groupId}/invitations/decline`,
    }));
    await renderAuthenticated(res, dependencies.renderAuthenticatedPage, status, {
      ...shell,
      page: 'profile',
      ...view,
      groups,
      pendingGroupInvitations,
      gliderEditor: gliderEditor ?? view.gliderEditor,
    });
    return true;
  }

  async function renderGroupPage(
    res: Response,
    currentUser: AuthenticatedUser,
    groupId: string,
    input: { month: string; pilotUserId?: string; selectedFlightId?: string },
  ) {
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const { group, standingsPage, pilots, flightPage, members } = await dependencies.groups.getPage({
      groupId,
      userId: currentUser.userId,
      competitionMonth: input.month,
      pilotUserId: input.pilotUserId,
    });
    const flightThumbnailUrls = dependencies.thumbnailDelivery
      ? await dependencies.thumbnailDelivery.signMany(flightPage.flights.map((flight) => ({
        userId: flight.pilotUserId,
        flightId: flight.flightId,
      })))
      : new Map();
    const groupHref = `/groups/${groupId}?month=${encodeURIComponent(input.month)}`;
    const selectedPilot = pilots.find((pilot) => pilot.userId === input.pilotUserId);
    if (input.pilotUserId && !selectedPilot) throw new GroupError('validation', 'Selected pilot is not a group member.');
    const standings = standingsPage.standings.map((standing) => ({
      userId: standing.userId,
      displayName: standing.displayName,
      initials: initialsForDisplayName(standing.displayName),
      color: standing.territoryColor,
      rank: standing.rank,
      cells: String(standing.claimedCellCount),
      fivePointDistance: formatGroupDistance(standing.bestFivePointDistanceMeters),
      isDistanceLeader: standing.trophy,
      isCurrent: standing.userId === currentUser.userId,
      filterHref: `${groupHref}&pilot=${encodeURIComponent(standing.userId)}`,
    }));
    const flights = flightPage.flights.map((flight) => {
      const pilot = pilots.find((member) => member.userId === flight.pilotUserId);
      return {
        id: flight.flightId,
        pilotName: flight.pilotName,
        pilotInitials: initialsForDisplayName(flight.pilotName),
        pilotColor: pilot?.territoryColor ?? '#1769AA',
        launchTime: formatGroupLaunchTime(flight.startedAt, flight.launchTimezone),
        fivePointDistance: formatGroupDistance(flight.fivePointDistanceMeters),
        duration: formatGroupDuration(flight.durationSeconds),
        thumbnail: flightThumbnailUrls.get(flight.flightId),
        detailHref: `/flights/${flight.flightId}`,
        trackHref: `/v1/groups/${groupId}/flights/${flight.flightId}/track?month=${encodeURIComponent(input.month)}`,
        isSelected: flight.flightId === input.selectedFlightId,
      };
    });
    const isOwner = group.ownerUserId === currentUser.userId;
    const shell = authenticatedShell('group', currentUser);
    const groupTileZoom = territoryTileSettings.get().competition;
    await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
      ...shell,
      page: 'group',
      group: {
        id: group.groupId,
        name: group.name,
        initials: initialsForDisplayName(group.name),
        month: input.month,
        monthLabel: formatGroupMonth(input.month),
        memberCount: String(group.memberCount),
        capacity: String(group.capacity),
        isOwner,
        inviteHref: isOwner ? '#group-member-management' : undefined,
        leaveHref: isOwner ? undefined : `/groups/${groupId}/leave`,
        deleteHref: isOwner ? `/groups/${groupId}/delete` : undefined,
        inviteSearchHref: isOwner ? `/v1/groups/${groupId}/invite-candidates` : undefined,
        inviteSubmitHref: isOwner ? `/groups/${groupId}/invitations` : undefined,
        members: isOwner ? (members ?? []).map((member) => ({
          userId: member.userId,
          displayName: member.displayName,
          status: member.status,
          removeHref: member.status === 'accepted' && !member.isOwner ? `/groups/${groupId}/members/${member.userId}/remove` : undefined,
          cancelHref: member.status === 'pending' ? `/groups/${groupId}/invitations/${member.userId}/cancel` : undefined,
        })) : undefined,
      },
      standings,
      flights,
      mapStyleUrl: dependencies.mapTilerStyleUrl,
      tileUrl: `/v1/groups/${groupId}/competition-territory/tiles/{z}/{x}/{y}.mvt?month=${encodeURIComponent(input.month)}${selectedPilot ? `&pilot=${encodeURIComponent(selectedPilot.userId)}` : ''}`,
      pilotColorsJson: JSON.stringify(Object.fromEntries(pilots.map((pilot) => [pilot.userId, pilot.territoryColor]))),
      territoryTileMinimumZoom: groupTileZoom.minimumZoom,
      territoryTileMaximumZoom: groupTileZoom.maximumZoom,
      selectedPilotId: selectedPilot?.userId,
      selectedPilotName: selectedPilot?.displayName,
      clearFilterHref: groupHref,
      selectedFlightId: input.selectedFlightId,
      standingsLoadMoreHref: standingsPage.nextOffset === null ? undefined : `/v1/groups/${groupId}/standings?month=${encodeURIComponent(input.month)}&offset=${standingsPage.nextOffset}`,
      flightsLoadMoreHref: flightPage.nextCursor ? `/v1/groups/${groupId}/flights?month=${encodeURIComponent(input.month)}${selectedPilot ? `&pilot=${encodeURIComponent(selectedPilot.userId)}` : ''}&cursor=${encodeURIComponent(flightPage.nextCursor)}` : undefined,
    });
  }

  function sendTerritoryTile(res: Response, tile: { data: Buffer }) {
    res.status(200)
      .type('application/vnd.mapbox-vector-tile')
      .set('Cache-Control', 'private, max-age=60')
      .send(tile.data);
  }

  function dashboardReturnTo(value: unknown): string {
    if (typeof value !== 'string') return '/global';
    try {
      const url = new URL(value, 'http://glidehero.local');
      if (url.origin !== 'http://glidehero.local') return '/global';
      const validPath = url.pathname === '/global'
        || url.pathname === '/personal'
        || /^\/arena\/[a-z]{2}\/[a-z0-9-]+-\d+$/.test(url.pathname);
      if (!validPath) return '/global';
      const month = url.searchParams.get('month');
      const period = url.searchParams.get('period');
      if (month && period) return '/global';
      const params = new URLSearchParams();
      if (month) {
        normalizeCompetitionLeaderboardMonth(month);
        params.set('month', month);
      } else if (period === 'all-time') {
        params.set('period', period);
      } else if (period) {
        return '/global';
      }
      for (const name of ['lat', 'lng', 'zoom']) {
        const value = url.searchParams.get(name);
        if (value) params.set(name, value);
      }
      return params.size > 0 ? `${url.pathname}?${params}` : url.pathname;
    } catch {
      return '/global';
    }
  }

  function dashboardSuccessRedirect(value: unknown, parameter: string): string {
    const url = new URL(dashboardReturnTo(value), 'http://glidehero.local');
    url.searchParams.set(parameter, 'success');
    return `${url.pathname}?${url.searchParams}`;
  }

  function followReturnTo(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    try {
      const url = new URL(value, 'http://glidehero.local');
      if (url.origin !== 'http://glidehero.local') return fallback;
      if (url.pathname === '/activity') {
        const q = url.searchParams.get('q');
        const scope = url.searchParams.get('scope');
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (scope === 'following' || scope === 'yours') params.set('scope', scope);
        return params.toString() ? `/activity?${params}` : '/activity';
      }
      if (url.pathname === '/profile' || /^\/pilots\/[0-9a-f-]{36}$/i.test(url.pathname)) return url.pathname;
    } catch {
      // Use the known local fallback below.
    }
    return fallback;
  }

  function hasAdminAccess(currentUser: AuthenticatedUser | null): boolean {
    return Boolean(currentUser && isAdmin(currentUser.email));
  }

  function authenticatedShell(page: 'map' | 'plan' | 'activity' | 'achievements' | 'profile' | 'flight' | 'group', currentUser: AuthenticatedUser, options: { mapHref?: string; showFooter?: boolean } = {}) {
    return createAuthenticatedShellModel({
      page,
      user: currentUser,
      isAdmin: isAdmin(currentUser.email),
      mapHref: options.mapHref,
      showFooter: options.showFooter,
    });
  }

  function productionMap(currentUser: AuthenticatedUser, input: Omit<Parameters<typeof createMapPageModel>[1], 'currentUserId' | 'territoryColor' | 'mapStyleUrl' | 'territoryTileMinimumZoom' | 'territoryTileMaximumZoom'>, options: { mapHref?: string; showFooter?: boolean } = {}) {
    const settings = territoryTileSettings.get();
    const isArenaMap = input.arenaSourceId !== undefined || input.focusArenaSourceId !== undefined;
    const currentMapUrl = new URL(input.mapHref, 'http://glidehero.local');
    const personalMapUrl = new URL('/personal', currentMapUrl);
    const followingMapUrl = new URL(isArenaMap ? input.mapHref : '/following', currentMapUrl);
    const competitiveMapUrl = new URL(isArenaMap ? input.mapHref : '/global', currentMapUrl);
    const clearLocationUrl = new URL(input.mode === 'following' ? '/following' : input.mode === 'personal' ? '/personal' : '/global', currentMapUrl);
    clearLocationUrl.search = currentMapUrl.search;
    clearLocationUrl.searchParams.delete('view');
    if (!isArenaMap) {
      personalMapUrl.search = currentMapUrl.search;
      followingMapUrl.search = currentMapUrl.search;
      competitiveMapUrl.search = currentMapUrl.search;
    }
    if (isArenaMap) followingMapUrl.searchParams.set('view', 'following');
    else followingMapUrl.searchParams.delete('view');
    competitiveMapUrl.searchParams.delete('view');
    return createMapPageModel(
      authenticatedShell('map', currentUser, { mapHref: options.mapHref ?? input.mapHref, showFooter: options.showFooter ?? false }),
      {
        ...input,
        mapModeHrefs: {
          personal: `${personalMapUrl.pathname}${personalMapUrl.search}`,
          following: `${followingMapUrl.pathname}${followingMapUrl.search}`,
          competitive: `${competitiveMapUrl.pathname}${competitiveMapUrl.search}`,
        },
        ...(isArenaMap ? { locationClearHref: `${clearLocationUrl.pathname}${clearLocationUrl.search}` } : {}),
        currentUserId: currentUser.userId,
        territoryColor: normalizeTerritoryColor(currentUser.territoryColor) ?? '#1769AA',
        mapStyleUrl: dependencies.mapTilerStyleUrl,
        territoryTileMinimumZoom: input.mode === 'personal' ? settings.personal.minimumZoom : settings.competition.minimumZoom,
        territoryTileMaximumZoom: input.mode === 'personal' ? settings.personal.maximumZoom : settings.competition.maximumZoom,
      },
    );
  }

  router.post('/v1/igc-uploads/intents', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before uploading an IGC file.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    const input = uploadIntentSchema.safeParse(req.body);
    if (!input.success) {
      next(new AppError(422, 'invalid_request', 'Choose a valid IGC file of 10 MB or less.'));
      return;
    }
    try {
      res.status(201).json(await dependencies.uploadQueue.createIntent({ userId: currentUser.userId, ...input.data }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/flight-upload-batches', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before uploading flights.'));
    if (!dependencies.uploadWorkflow) throw new Error('Upload workflow is not configured.');
    try {
      res.status(201).json(await dependencies.uploadWorkflow.createRegularBatch(currentUser.userId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/flight-upload-batches/:batchId/seal', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before uploading flights.'));
    if (!dependencies.uploadWorkflow) throw new Error('Upload workflow is not configured.');
    if (!z.string().uuid().safeParse(req.params.batchId).success) return next(new AppError(400, 'invalid_request', 'Upload batch ID is invalid.'));
    try {
      const sealed = await dependencies.uploadWorkflow.sealRegularBatch(req.params.batchId, currentUser.userId);
      if (!sealed) throw new AppError(409, 'conflict', 'This upload batch is no longer accepting changes.');
      await activateNextRegular(currentUser.userId);
      res.status(202).json({ status: 'processing' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/flight-history-imports', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before uploading flight history.'));
    if (!dependencies.uploadWorkflow) throw new Error('Upload workflow is not configured.');
    try {
      res.status(201).json(await dependencies.uploadWorkflow.createBulkImport(currentUser.userId));
    } catch (error) {
      if (error instanceof Error && error.message === 'An active bulk import already exists') {
        return next(new AppError(409, 'conflict', error.message));
      }
      next(error);
    }
  });

  router.post('/v1/flight-history-imports/:importId/seal', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before uploading flight history.'));
    if (!dependencies.uploadWorkflow) throw new Error('Upload workflow is not configured.');
    if (!z.string().uuid().safeParse(req.params.importId).success) return next(new AppError(400, 'invalid_request', 'History import ID is invalid.'));
    try {
      const sealed = await dependencies.uploadWorkflow.sealBulkImport(req.params.importId, currentUser.userId);
      if (!sealed) throw new AppError(409, 'conflict', 'This historical upload is no longer accepting changes.');
      const member = await activateNextBulk(req.params.importId, currentUser.userId);
      if (!member && !(await dependencies.uploadWorkflow.beginBulkReplay(req.params.importId, currentUser.userId))) {
        throw new AppError(409, 'conflict', 'This historical upload is no longer active.');
      }
      res.status(202).json({ status: member ? 'processing' : 'replaying' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/v1/flight-history-imports/:importId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before managing flight history.'));
    if (!dependencies.uploadWorkflow || !dependencies.uploadQueue) throw new Error('Upload workflow is not configured.');
    if (!z.string().uuid().safeParse(req.params.importId).success) return next(new AppError(400, 'invalid_request', 'History import ID is invalid.'));
    try {
      const { cancelled, jobs } = await dependencies.uploadWorkflow.cancelBulkImport(req.params.importId, currentUser.userId);
      if (!cancelled) throw new AppError(409, 'conflict', 'This historical upload has already started or ended.');
      for (const item of jobs) {
        const job = await dependencies.uploadQueue.getJob(item.uploadJobId);
        if (job && !['completed', 'duplicate', 'failed'].includes(job.status)) {
          await dependencies.uploadQueue.saveJob({ ...job, status: 'failed', error: item.reason, updatedAt: Date.now() });
        }
      }
      res.status(200).json({ cancelled: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/igc-uploads/:uploadId/complete', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before uploading an IGC file.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    if (!z.string().uuid().safeParse(req.params.uploadId).success) {
      next(new AppError(400, 'invalid_request', 'Upload ID is invalid.'));
      return;
    }
    try {
      await dependencies.uploadQueue.complete({ userId: currentUser.userId, id: req.params.uploadId });
      res.status(202).json({ status: 'queued' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/v1/igc-uploads/:uploadId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before managing an IGC upload.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    if (!z.string().uuid().safeParse(req.params.uploadId).success) {
      next(new AppError(400, 'invalid_request', 'Upload ID is invalid.'));
      return;
    }
    try {
      const removed = await dependencies.uploadQueue.cancel({ userId: currentUser.userId, id: req.params.uploadId });
      res.status(200).json({ removed });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/igc-upload-progress', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view upload progress.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    try {
      res.status(200).json(await dependencies.uploadQueue.progress(currentUser.userId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/igc-upload-jobs', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view upload details.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    const page = z.coerce.number().int().min(1).catch(1).parse(req.query.page);
    try {
      res.status(200).json(await dependencies.uploadQueue.listJobs(currentUser.userId, { page, pageSize: 100 }));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/v1/igc-upload-failures', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to clear failed uploads.'));
      return;
    }
    if (!dependencies.failedFlightCleanup) throw new Error('Failed-flight cleanup is not configured.');
    try {
      res.status(200).json({ cleared: await dependencies.failedFlightCleanup.clearForUser(currentUser.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view your personal territory.'));
      return;
    }
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().personal, req.params);
    const period = personalPeriodSchema.safeParse(req.query);
    if (!coordinates || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Personal territory tile coordinates are invalid.' } });
      return;
    }
    try {
      const tile = await dependencies.territoryTiles.getPersonalTile({
        ...coordinates,
        userId: currentUser.userId,
        period: coveragePeriod(period.data.month),
      });
      res.vary('Cookie');
      sendTerritoryTile(res, tile);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-stats', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view your personal stats.'));
      return;
    }

    const viewport = z.object({
      month: competitionMonthValue.optional(),
      ...viewportBoundsShape,
    }).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east)
      .safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Personal stats require valid viewport bounds.' },
      });
      return;
    }

    try {
      const stats = await dependencies.gridClaim.getViewportStats({
        userId: currentUser.userId,
        west: viewport.data.west,
        south: viewport.data.south,
        east: viewport.data.east,
        north: viewport.data.north,
        period: coveragePeriod(viewport.data.month),
      });
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/grid', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the map grid.'));
      return;
    }
    const viewport = viewportBoundsSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Grid requires valid viewport bounds.' },
      });
      return;
    }
    try {
      const result = await dependencies.mapGrid.getViewport(viewport.data);
      if (result.status === 'too_large') {
        res.status(422).json({
          error: { code: 'grid_viewport_too_large', message: 'Zoom in to view grid.' },
        });
        return;
      }
      res.status(200).type('application/geo+json').send(result.geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/map-launches', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map launches.'));
    const parsed = z.object({ ...viewportBoundsShape, ...flightMapFilterShape }).strict().superRefine((value, context) => {
      refineFlightMapDates(value, context);
      if (value.south >= value.north || value.west === value.east) context.addIssue({ code: 'custom', message: 'Flight map viewport is invalid.' });
    }).safeParse(req.query);
    if (!parsed.success) return next(new AppError(400, 'invalid_request', 'Launch map viewport is invalid.'));
    if (!dependencies.launchMap) throw new Error('Launch map service is not configured.');
    try {
      const { west, south, east, north, scope, period, anchor, start, end, launch } = parsed.data;
      const launches = await dependencies.launchMap.listViewportMarkers({
        viewport: { west, south, east, north }, viewerUserId: currentUser.userId, scope, period,
        ...(launch === undefined ? {} : { launch }),
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
      });
      res.status(200).set('Cache-Control', 'private, no-store').json({ launches });
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-launches/options', async (req, res, next) => {
    if (!res.locals.currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before searching map launches.'));
    const parsed = launchOptionsQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(new AppError(400, 'invalid_request', 'Launch options query is invalid.'));
    if (!dependencies.launchMap) throw new Error('Launch map service is not configured.');
    try {
      const launches = 'q' in parsed.data
        ? await dependencies.launchMap.listLaunchOptions({ query: parsed.data.q })
        : await dependencies.launchMap.listLaunchOptions({ viewport: parsed.data });
      res.status(200).set('Cache-Control', 'private, no-store').json({ launches });
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-launches/:launchId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map launches.'));
    const launchId = z.coerce.number().int().positive().safeParse(req.params.launchId);
    const parsed = z.object({
      scope: flightMapScopeSchema,
      period: flightMapPeriodSchema,
      anchor: flightMapAnchorSchema.optional(),
      start: flightMapAnchorSchema.optional(),
      end: flightMapAnchorSchema.optional(),
      launch: z.union([z.literal('unknown'), z.coerce.number().int().positive()]).optional(),
    }).strict().superRefine(refineFlightMapDates).safeParse(req.query);
    if (!launchId.success || !parsed.success) return next(new AppError(400, 'invalid_request', 'Launch detail query is invalid.'));
    if (!dependencies.launchMap) throw new Error('Launch map service is not configured.');
    const { scope, period, anchor, start, end, launch: launchFilter } = parsed.data;
    try {
      const launch = await dependencies.launchMap.getLaunchDetail({
        launchId: launchId.data,
        viewerUserId: currentUser.userId,
        scope,
        period,
        ...(launchFilter === undefined ? {} : { launch: launchFilter }),
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
      });
      if (!launch) return next(new AppError(404, 'not_found', 'Launch not found.'));
      res.status(200).set('Cache-Control', 'private, no-store').json(launch);
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-flights/tracks', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map flights.'));
    const parsed = flightMapTrackQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(new AppError(400, 'invalid_request', 'Flight map track query is invalid.'));
    if (!dependencies.flightMap) throw new Error('Flight map service is not configured.');
    const { west, south, east, north, zoom, scope, period, anchor, start, end, launch } = parsed.data;
    try {
      const page = await dependencies.flightMap.listViewportTracks({
        viewerUserId: currentUser.userId,
        scope,
        period,
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
        ...(launch === undefined ? {} : { launch }),
        viewport: { west, south, east, north },
        zoom,
      });
      res.status(200).set('Cache-Control', 'private, no-store').json(page);
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-flights', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map flights.'));
    const parsed = flightMapListQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(new AppError(400, 'invalid_request', 'Flight map list query is invalid.'));
    if (!dependencies.flightMap) throw new Error('Flight map service is not configured.');
    const { scope, period, anchor, start, end, launch, geography, sort, cursor, west, south, east, north } = parsed.data;
    try {
      const page = await dependencies.flightMap.listFlights({
        viewerUserId: currentUser.userId,
        scope,
        period,
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
        ...(launch === undefined ? {} : { launch }),
        geography,
        sort,
        ...(cursor === undefined ? {} : { cursor }),
        ...(geography === 'map-area'
          ? { viewport: { west: west!, south: south!, east: east!, north: north! } }
          : {}),
      });
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(page.items.map((item) => ({ userId: item.pilotUserId, flightId: item.flightId })))
        : undefined;
      res.status(200).set('Cache-Control', 'private, no-store').json(flightMapListPageToPayload(page, { thumbnailUrls }));
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-flights/:flightId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map flights.'));
    const flightId = z.string().uuid().safeParse(req.params.flightId);
    const parsed = flightMapSelectionQuerySchema.safeParse(req.query);
    if (!flightId.success || !parsed.success) return next(new AppError(400, 'invalid_request', 'Flight map selection query is invalid.'));
    if (!dependencies.flightMap) throw new Error('Flight map service is not configured.');
    const { scope, period, anchor, start, end, launch, geography, west, south, east, north } = parsed.data;
    try {
      const flight = await dependencies.flightMap.getFlight({
        flightId: flightId.data,
        viewerUserId: currentUser.userId,
        scope,
        period,
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
        ...(launch === undefined ? {} : { launch }),
        geography,
        ...(geography === 'map-area' ? { viewport: { west: west!, south: south!, east: east!, north: north! } } : {}),
      });
      if (!flight) return next(new AppError(404, 'not_found', 'Flight is not available in this map context.'));
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany([{ userId: flight.pilotUserId, flightId: flight.flightId }])
        : undefined;
      res.status(200).set('Cache-Control', 'private, no-store').json(flightMapListPageToPayload({ items: [flight], nextCursor: null }, { thumbnailUrls }).items[0]);
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/personal-history/summary', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing personal history.'));
    const parsed = personalHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(new AppError(400, 'invalid_request', 'Personal history query is invalid.'));
    if (!dependencies.flightMap) throw new Error('Flight map service is not configured.');
    const { scope, period, anchor, start, end, launch, geography, west, south, east, north } = parsed.data;
    try {
      const result = await dependencies.flightMap.getPersonalSummary({
        viewerUserId: currentUser.userId, scope, period, geography,
        ...(anchor === undefined ? {} : { anchor }),
        ...(start === undefined ? {} : { startDate: start }),
        ...(end === undefined ? {} : { endDate: end }),
        ...(launch === undefined ? {} : { launch }),
        ...(geography === 'map-area' ? { viewport: { west: west!, south: south!, east: east!, north: north! } } : {}),
      });
      res.status(200).set('Cache-Control', 'private, no-store').json(result);
    } catch (error) {
      next(error instanceof FlightMapInputError ? new AppError(400, 'invalid_request', error.message) : error);
    }
  });

  router.get('/v1/map-replay', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map replay.'));
    const parsed = z.object({ month: competitionMonthValue, mode: z.enum(['personal','competitive','following']), west: z.coerce.number().finite(), south: z.coerce.number().finite(), east: z.coerce.number().finite(), north: z.coerce.number().finite() }).safeParse(req.query);
    if (!parsed.success || parsed.data.south < -90 || parsed.data.north > 90 || parsed.data.south >= parsed.data.north || parsed.data.west < -180 || parsed.data.west > 180 || parsed.data.east < -180 || parsed.data.east > 180 || parsed.data.west === parsed.data.east) return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid map replay parameters.' } });
    if (!dependencies.mapReplay) throw new Error('Map replay service is not configured.');
    try { res.json(await dependencies.mapReplay.getReplay({ ...parsed.data, userId: currentUser.userId })); } catch (error) { next(error); }
  });

  router.get('/v1/map-flights/:flightId/replay', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before replaying a map flight.'));
      return;
    }
    const flightId = pilotUserIdSchema.safeParse(req.params.flightId);
    if (!flightId.success) {
      next();
      return;
    }
    if (!dependencies.mapReplay) throw new Error('Map replay service is not configured.');
    try {
      const flight = await dependencies.mapReplay.getFlightReplay({ flightId: flightId.data });
      if (!flight) {
        next();
        return;
      }
      res.status(200).set('Cache-Control', 'private, no-store').json({ flights: [flight] });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view competition territory.'));
      return;
    }
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().competition, req.params);
    const query = tileQuerySchema.safeParse(req.query);
    if (!coordinates || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Competition territory tile request is invalid.' } });
      return;
    }
    try {
      if (query.data.scope === 'following') res.vary('Cookie');
      sendTerritoryTile(res, await dependencies.territoryTiles.getGlobalCompetitionTile({
        ...coordinates,
        period: coveragePeriod(query.data.month),
        ...(query.data.scope ? { currentUserId: res.locals.currentUser.userId } : {}),
        ...(query.data.scope ? { scope: query.data.scope } : {}),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-leaderboard', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the competition leaderboard.'));
      return;
    }

    const viewport = competitionLeaderboardSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Competition leaderboard requires a valid YYYY-MM month and viewport bounds.' },
      });
      return;
    }

    try {
      const leaderboard = await dependencies.coverage.getGlobalLeaderboard({
        ...coveragePeriod(viewport.data.month),
        west: viewport.data.west,
        south: viewport.data.south,
        east: viewport.data.east,
        north: viewport.data.north,
        currentUserId: currentUser.userId,
        ...(viewport.data.scope ? { scope: viewport.data.scope } : {}),
      });
      res.status(200).json(leaderboard);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to search Arenas.'));
      return;
    }
    const input = arenaSearchSchema.safeParse(req.query);
    if (!input.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena search requires a query.' } });
      return;
    }
    try {
      res.status(200).json({ arenas: await dependencies.arenas.search(input.data.q) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/boundary', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view an Arena.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    if (!sourceId.success) {
      res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      res.status(200).type('application/geo+json').send(arena.boundary);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/grid', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view an Arena grid.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const viewport = viewportBoundsSchema.safeParse(req.query);
    if (!sourceId.success || !viewport.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena grid requires a valid Arena and viewport bounds.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      const grid = await dependencies.mapGrid.getArena({ arenaId: arena.id, ...viewport.data });
      if (grid.status === 'too_large') {
        res.status(422).json({ error: { code: 'grid_viewport_too_large', message: 'Zoom in to view grid.' } });
        return;
      }
      res.status(200).type('application/geo+json').send(grid.geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/competition-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view Arena territory.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().competition, req.params);
    const query = tileQuerySchema.safeParse(req.query);
    if (!sourceId.success || !coordinates || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena territory tile request is invalid.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      if (query.data.scope === 'following') res.vary('Cookie');
      sendTerritoryTile(res, await dependencies.territoryTiles.getArenaCompetitionTile({
        ...coordinates,
        arenaId: arena.id,
        period: coveragePeriod(query.data.month),
        ...(query.data.scope ? { currentUserId: currentUser.userId } : {}),
        ...(query.data.scope ? { scope: query.data.scope } : {}),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/competition-leaderboard', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the Arena leaderboard.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const period = competitionMonthSchema.safeParse(req.query);
    if (!sourceId.success || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena leaderboard requires a valid Arena and YYYY-MM month.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      res.status(200).json(await dependencies.coverage.getArenaLeaderboard({
        ...coveragePeriod(period.data.month),
        arenaId: arena.id,
        currentUserId: currentUser.userId,
        ...(period.data.scope ? { scope: period.data.scope } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-cells/:x/:y/tracks', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view cell flight tracks.'));
      return;
    }
    const x = cellCoordinateSchema.safeParse(req.params.x);
    const y = cellCoordinateSchema.safeParse(req.params.y);
    const period = personalPeriodSchema.safeParse(req.query);
    if (!x.success || !y.success || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Cell flight tracks require valid coordinates and an optional YYYY-MM month.' } });
      return;
    }
    if (!dependencies.cellFlightTracks) throw new Error('Cell flight-track service is not configured.');
    try {
      const tracks = await dependencies.cellFlightTracks.getPersonal({
        x: x.data,
        y: y.data,
        userId: currentUser.userId,
        period: coveragePeriod(period.data.month),
      });
      res.status(200).type('application/geo+json').send(tracks);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-cells/:x/:y/tracks', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view cell flight tracks.'));
      return;
    }
    const x = cellCoordinateSchema.safeParse(req.params.x);
    const y = cellCoordinateSchema.safeParse(req.params.y);
    const query = tileQuerySchema.safeParse(req.query);
    if (!x.success || !y.success || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Cell flight tracks require valid coordinates, an optional YYYY-MM month, and an optional pilot ID.' } });
      return;
    }
    if (!dependencies.cellFlightTracks) throw new Error('Cell flight-track service is not configured.');
    try {
      const tracks = await dependencies.cellFlightTracks.getCompetition({
        x: x.data,
        y: y.data,
        period: coveragePeriod(query.data.month),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
        currentUserId: currentUser.userId,
        ...(query.data.scope ? { scope: query.data.scope } : {}),
      });
      res.status(200).type('application/geo+json').send(tracks);
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res) => {
    if (res.locals.currentUser) {
      res.redirect(302, '/following');
      return;
    }
    await render(res, dependencies.renderPage, 200, {
      currentUser: null,
      page: 'landing',
    });
  });

  router.get('/global', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query);
      const mapHref = `/global${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'competitive', period: selection.period, location: null, mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/following', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query);
      await dependencies.onboarding?.markCompetitiveMapViewed(currentUser.userId);
      const mapHref = `/following${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'following', period: selection.period, location: null, mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/personal', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query, { allowDay: false });
      const mapHref = `/personal${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'personal', period: selection.period, location: null, mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/plan', async (_req, res) => {
    const currentUser = res.locals.currentUser;
    const shell = currentUser
      ? { ...authenticatedShell('plan', currentUser, { showFooter: false }), isGuest: false as const }
      : { page: 'plan' as const, title: 'Plan · GlideHero', isGuest: true as const, showFooter: false as const };
    await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
      ...shell,
      page: 'plan',
      mapStyleUrl: dependencies.mapTilerStyleUrl ?? '',
      thermalTileUrl: '/v1/thermal/tiles/{z}/{x}/{y}.png',
      defaultRoutingPriority: 'balanced',
    });
  });

  router.get('/v1/thermal/tiles/:z/:x/:y.png', async (req, res, next) => {
    if (!dependencies.thermalRasters) throw new Error('Thermal raster cache is not configured.');
    const zoom = thermalTileCoordinateSchema.safeParse(req.params.z);
    const x = thermalTileCoordinateSchema.safeParse(req.params.x);
    const xyzY = thermalTileCoordinateSchema.safeParse(req.params.y);
    if (!zoom.success || !x.success || !xyzY.success) return next(new AppError(400, 'invalid_request', 'Thermal tile coordinates are invalid.'));
    const tileWidth = 2 ** zoom.data;
    if (zoom.data > THERMAL_NATIVE_ZOOM || x.data >= tileWidth || xyzY.data >= tileWidth) {
      return next(new AppError(400, 'invalid_request', 'Thermal tile coordinates are invalid.'));
    }
    try {
      const tile = await dependencies.thermalRasters.get({ zoom: zoom.data, x: x.data, tmsY: xyzYToTmsY(zoom.data, xyzY.data) });
      if (!tile) {
        res.status(404).set('Cache-Control', 'private, max-age=300').end();
        return;
      }
      res.status(200)
        .type(tile.contentType)
        .set('Cache-Control', 'private, max-age=86400')
        .set('X-GlideHero-Thermal-Cache', tile.cache)
        .send(tile.body);
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/plan/route', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!dependencies.plans) throw new Error('Flight planning is not configured.');
    const parsed = planRouteSchema.safeParse(req.body);
    if (!parsed.success) return next(new AppError(422, 'invalid_request', 'Provide 2–24 valid route points and a routing priority.'));
    try {
      const result = await dependencies.plans.route({ userId: currentUser?.userId ?? null, ...parsed.data });
      const exportToken = currentUser && dependencies.planExports
        ? await dependencies.planExports.authorize({ userId: currentUser.userId, anchors: result.anchors, route: result.route })
        : undefined;
      res.status(200).json({ ...result, exportToken });
    } catch (error) {
      if (error instanceof RangeError) return next(new AppError(422, 'invalid_request', error.message));
      next(error);
    }
  });

  router.post('/v1/plan/export', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before exporting a flight plan.'));
    if (!dependencies.planExports) throw new Error('Flight plan export is not configured.');
    const parsed = planExportSchema.safeParse(req.body);
    if (!parsed.success) return next(new AppError(422, 'invalid_request', 'Choose a supported export format and provide a valid route export token.'));
    try {
      const result = await dependencies.planExports.export({ userId: currentUser.userId, ...parsed.data });
      res.status(200)
        .type(result.contentType)
        .set('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.body);
    } catch (error) {
      if (error instanceof RangeError) return next(new AppError(422, 'invalid_request', error.message));
      next(error);
    }
  });

  router.get('/flights/:flightId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    const parsedFlightId = pilotUserIdSchema.safeParse(req.params.flightId);
    if (!parsedFlightId.success) {
      next();
      return;
    }
    if (!dependencies.flightDetail) throw new Error('Flight detail service is not configured.');
    try {
      const summary = await dependencies.flightDetail.getSummary(parsedFlightId.data);
      if (!summary) {
        next();
        return;
      }
      if (currentUser) {
        const shell = authenticatedShell('flight', currentUser, { showFooter: false });
        await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
          ...shell,
          page: 'flight',
          flight: {
            ...createFlightPageView(summary),
            mapStyleUrl: dependencies.mapTilerStyleUrl,
          },
        });
        return;
      }
      if (!dependencies.renderPublicFlightPage) throw new Error('Public flight detail renderer is not configured.');
      const publicOrigin = dependencies.publicOrigin ?? 'https://glidehero.com';
      const flight = createPublicFlightPageView(summary);
      const thumbnailUrl = await dependencies.thumbnailDelivery?.signWideIfExists({
        userId: summary.ownerUserId,
        flightId: summary.id,
      });
      const imageUrl = thumbnailUrl ?? new URL('/flight-thumbnail-fallback.webp', publicOrigin).toString();
      await renderPublicFlight(res, dependencies.renderPublicFlightPage, 200, {
        page: 'flight',
        title: `${summary.ownerDisplayName}’s flight · GlideHero`,
        socialPreview: createFlightSocialPreview({
          flight,
          publicOrigin,
          imageUrl,
          imageWidth: thumbnailUrl ? 800 : 450,
          imageHeight: 450,
        }),
        flight: {
          ...flight,
          mapStyleUrl: dependencies.mapTilerStyleUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/flights/:flightId/map', async (req, res, next) => {
    const parsedFlightId = pilotUserIdSchema.safeParse(req.params.flightId);
    if (!parsedFlightId.success) {
      next();
      return;
    }
    if (!dependencies.flightDetail) throw new Error('Flight detail service is not configured.');
    try {
      const [summary, mapData] = await Promise.all([
        dependencies.flightDetail.getSummary(parsedFlightId.data),
        dependencies.flightDetail.getMapData(parsedFlightId.data),
      ]);
      if (!summary || !mapData) {
        next();
        return;
      }
      res.status(200).set('Cache-Control', 'private, max-age=60').json(createFlightMapPayload(summary, mapData));
    } catch (error) {
      next(error);
    }
  });

  router.get('/groups/new', (_req, res) => {
    res.redirect(302, '/profile#new-group');
  });

  router.post('/groups', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const parsed = z.object({ name: groupNameSchema }).strict().safeParse(formBody(req.body));
    if (!parsed.success) return next(new AppError(422, 'invalid_request', 'Enter a group name of up to 80 characters.'));
    try {
      const group = await dependencies.groups.createGroup({ ownerUserId: currentUser.userId, name: parsed.data.name });
      res.redirect(303, `/groups/${group.groupId}`);
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/groups/:groupId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    const parsedId = groupIdSchema.safeParse(req.params.groupId);
    const parsedQuery = groupMonthQuerySchema.safeParse(req.query);
    if (!parsedId.success) return next();
    if (!parsedQuery.success) return next(new AppError(422, 'invalid_request', 'Group competition request is invalid.'));
    try {
      await renderGroupPage(res, currentUser, parsedId.data, {
        month: parsedQuery.data.month ?? currentCompetitionMonth(),
        pilotUserId: parsedQuery.data.pilot,
        selectedFlightId: parsedQuery.data.flight,
      });
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/v1/groups/:groupId/invite-candidates', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in to manage a group.'));
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const parsed = z.object({ groupId: groupIdSchema }).safeParse(req.params);
    const query = z.object({ q: z.string().trim().min(1).max(100) }).strict().safeParse(req.query);
    if (!parsed.success || !query.success) return next(new AppError(422, 'invalid_request', 'Enter a pilot name.'));
    try {
      const group = await dependencies.groups.getGroup({ groupId: parsed.data.groupId, userId: currentUser.userId });
      if (group.ownerUserId !== currentUser.userId) throw new GroupError('forbidden', 'Only the group owner can invite pilots.');
      res.status(200).set('Cache-Control', 'private, no-store').json(await dependencies.groups.searchPilots({ query: query.data.q, excludeUserId: currentUser.userId, excludeGroupId: group.groupId }));
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/v1/groups/:groupId/standings', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in to view group standings.'));
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    const query = z.object({ month: currentGroupMonthValue, offset: z.coerce.number().int().min(0).max(200).default(0) }).strict().safeParse(req.query);
    if (!groupId.success || !query.success) return next(new AppError(422, 'invalid_request', 'Standings request is invalid.'));
    try {
      const page = await dependencies.groups.getStandingsPage({
        groupId: groupId.data,
        userId: currentUser.userId,
        competitionMonth: query.data.month,
        offset: query.data.offset,
        limit: 25,
      });
      res.status(200).set('Cache-Control', 'private, max-age=30').json(page);
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/v1/groups/:groupId/flights', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in to view group flights.'));
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    const query = z.object({ month: currentGroupMonthValue, pilot: pilotUserIdSchema.optional(), cursor: z.string().max(500).optional() }).strict().safeParse(req.query);
    if (!groupId.success || !query.success) return next(new AppError(422, 'invalid_request', 'Flight request is invalid.'));
    try {
      const page = await dependencies.groups.listFlights({
        groupId: groupId.data, userId: currentUser.userId, competitionMonth: query.data.month,
        pilotUserId: query.data.pilot, cursor: query.data.cursor,
      });
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(page.flights.map((flight) => ({
          userId: flight.pilotUserId,
          flightId: flight.flightId,
        })))
        : new Map();
      res.status(200).set('Cache-Control', 'private, max-age=30').json({
        ...page,
        flights: page.flights.map((flight) => ({ ...flight, thumbnail: thumbnailUrls.get(flight.flightId) })),
      });
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/v1/groups/:groupId/flights/:flightId/track', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in to view a group flight.'));
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const params = z.object({ groupId: groupIdSchema, flightId: z.string().uuid() }).safeParse(req.params);
    const query = z.object({ month: currentGroupMonthValue }).strict().safeParse(req.query);
    if (!params.success || !query.success) return next();
    try {
      const track = await dependencies.groups.getFlightTrack({ groupId: params.data.groupId, userId: currentUser.userId, flightId: params.data.flightId, competitionMonth: query.data.month });
      if (!track) return next();
      res.status(200).set('Cache-Control', 'private, max-age=60').json({ type: 'Feature', geometry: track.geometry, properties: { flightId: track.flightId, pilotUserId: track.pilotUserId } });
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.get('/v1/groups/:groupId/competition-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in to view group territory.'));
    if (!dependencies.groups || !dependencies.territoryTiles.getGroupCompetitionTile) throw new Error('Group territory is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    const query = groupTileQuerySchema.safeParse(req.query);
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().competition, req.params as Record<string, string>);
    if (!groupId.success || !query.success || !coordinates) return next();
    try {
      const tile = await dependencies.territoryTiles.getGroupCompetitionTile({
        ...coordinates, groupId: groupId.data, currentUserId: currentUser.userId,
        period: { competitionMonth: query.data.month }, pilotUserId: query.data.pilot,
      });
      if (!tile.authorized) throw new GroupError('forbidden', 'Group access denied.');
      res.vary('Cookie');
      sendTerritoryTile(res, tile);
    } catch (error) {
      next(error instanceof GroupError ? groupErrorToAppError(error) : error);
    }
  });

  router.post('/groups/:groupId/invitations', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const input = z.object({ groupId: groupIdSchema, userId: pilotUserIdSchema }).safeParse({ ...req.params, ...formBody(req.body) });
    if (!input.success) return next(new AppError(422, 'invalid_request', 'Select a registered pilot to invite.'));
    try {
      await dependencies.groups.invite({ groupId: input.data.groupId, actorUserId: currentUser.userId, userId: input.data.userId });
      res.redirect(303, `/groups/${input.data.groupId}`);
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/invitations/accept', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    if (!groupId.success) return next();
    try {
      await dependencies.groups.acceptInvitation({ groupId: groupId.data, userId: currentUser.userId });
      res.redirect(303, `/groups/${groupId.data}`);
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/invitations/decline', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    if (!groupId.success) return next();
    try {
      await dependencies.groups.declineInvitation({ groupId: groupId.data, userId: currentUser.userId });
      res.redirect(303, '/profile');
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/invitations/:userId/cancel', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const input = z.object({ groupId: groupIdSchema, userId: pilotUserIdSchema }).safeParse(req.params);
    if (!input.success) return next();
    try {
      await dependencies.groups.cancelInvitation({ groupId: input.data.groupId, actorUserId: currentUser.userId, userId: input.data.userId });
      res.redirect(303, `/groups/${input.data.groupId}`);
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/members/:userId/remove', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const input = z.object({ groupId: groupIdSchema, userId: pilotUserIdSchema }).safeParse(req.params);
    if (!input.success) return next();
    try {
      await dependencies.groups.removeMember({ groupId: input.data.groupId, actorUserId: currentUser.userId, userId: input.data.userId });
      res.redirect(303, `/groups/${input.data.groupId}`);
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/leave', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    if (!groupId.success) return next();
    try {
      await dependencies.groups.leave({ groupId: groupId.data, userId: currentUser.userId });
      res.redirect(303, '/profile');
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.post('/groups/:groupId/delete', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return res.redirect(302, '/');
    if (!dependencies.groups) throw new Error('Group service is not configured.');
    const groupId = groupIdSchema.safeParse(req.params.groupId);
    if (!groupId.success) return next();
    try {
      await dependencies.groups.deleteGroup({ groupId: groupId.data, actorUserId: currentUser.userId });
      res.redirect(303, '/profile');
    } catch (error) { next(error instanceof GroupError ? groupErrorToAppError(error) : error); }
  });

  router.get('/profile', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      if (!(await renderCurrentProfile(res, currentUser, 200))) next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/achievements', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const profile = await dependencies.profiles.getPilotAchievements(currentUser.userId);
      if (!profile) {
        next();
        return;
      }
      const shell = authenticatedShell('achievements', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, createAchievementsPageModel(profile, shell));
    } catch (error) {
      next(error);
    }
  });

  router.get('/pilots/:userId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    const parsedUserId = pilotUserIdSchema.safeParse(req.params.userId);
    if (!parsedUserId.success) {
      next();
      return;
    }
    try {
      const profile = await dependencies.profiles.getPilotProfile(parsedUserId.data);
      if (!profile) {
        next();
        return;
      }
      const profileIsCurrent = parsedUserId.data === currentUser.userId;
      const profileIsFollowed = profileIsCurrent
        ? false
        : dependencies.follow ? await dependencies.follow.isFollowing({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data }) : false;
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(profile.recentFlights.map((flight) => ({ userId: profile.userId, flightId: flight.flightId })))
        : undefined;
      const shell = authenticatedShell('profile', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        page: 'profile',
        ...pilotProfileToView(profile, { isCurrent: profileIsCurrent, isFollowed: profileIsFollowed, currentPath: `/pilots/${parsedUserId.data}`, thumbnailUrls }),
      });
    } catch (error) {
      next(error);
    }
  });

  async function activityFeedRequest(req: Request, res: Response, next: NextFunction, fragment: boolean) {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      if (fragment) next(new AppError(401, 'unauthorized', 'Sign in before viewing activity.'));
      else res.redirect(302, '/');
      return;
    }
    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, 'invalid_request', 'Activity query is invalid.'));
      return;
    }
    const query = parsed.data.q?.trim() ?? '';
    const scope = parsed.data.scope ?? 'following';
    try {
      const [activityFeed, activityStatistics, onboardingState] = await Promise.all([
        dependencies.activity
          ? dependencies.activity.listFeed({ viewerUserId: currentUser.userId, limit: 20, before: parsed.data.before, q: query, scope })
          : Promise.resolve({ items: [], nextCursor: null }),
        !fragment && dependencies.activity
          ? dependencies.activity.getStatistics({ viewerUserId: currentUser.userId, q: query, scope })
          : Promise.resolve(null),
        !fragment && dependencies.onboarding
          ? dependencies.onboarding.getState(currentUser.userId)
          : Promise.resolve(null),
      ]);
      const activityParams = new URLSearchParams();
      if (query) activityParams.set('q', query);
      activityParams.set('scope', scope);
      const activityQuery = activityParams.toString();
      const activityReturnTo = activityQuery ? `/activity?${activityQuery}` : '/activity';
      const activityScopeLinks = {
        following: `/activity?${new URLSearchParams({ ...(query ? { q: query } : {}), scope: 'following' })}`,
        yours: `/activity?${new URLSearchParams({ ...(query ? { q: query } : {}), scope: 'yours' })}`,
      };
      const activityPilotResults = !fragment && query && dependencies.follow
        ? (await dependencies.follow.searchPilots({ viewerUserId: currentUser.userId, query })).map(activityPilotResultToView)
        : [];
      const activityLoadMoreHref = activityFeed.nextCursor
        ? `/activity?before=${encodeURIComponent(activityFeed.nextCursor)}${activityQuery ? `&${activityQuery}` : ''}`
        : '';
      const activityLoadMoreEndpoint = activityFeed.nextCursor
        ? `/activity/feed?before=${encodeURIComponent(activityFeed.nextCursor)}${activityQuery ? `&${activityQuery}` : ''}`
        : '';
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(activityFeed.items
          .filter((item) => item.activityType === 'flight' && item.sourceFlightId)
          .map((item) => ({ userId: item.actorUserId, flightId: item.sourceFlightId as string })))
        : undefined;
      if (fragment) {
        res.status(200).type('html').send(await dependencies.renderAuthenticatedActivityFeed({
          events: activityFeedToViews(activityFeed.items, { thumbnailUrls }), activityLoadMoreHref, activityLoadMoreEndpoint,
        }));
        return;
      }
      const shell = authenticatedShell('activity', currentUser);
      const onboarding = onboardingState
        ? createOnboardingView(onboardingState, parsed.data.onboardingStep as OnboardingStepKey | undefined)
        : undefined;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        gettingStarted: onboarding && !onboarding.allComplete ? { dismissed: onboarding.dismissed } : undefined,
        page: 'activity',
        events: activityFeedToViews(activityFeed.items, { thumbnailUrls }),
        activityStats: activityStatsToView(activityStatistics ?? emptyActivityStatistics),
        activitySearch: query,
        activityPilotResults,
        activityReturnTo,
        activityScopeLinks,
        activityScope: scope,
        activityLoadMoreHref,
        activityLoadMoreEndpoint,
        onboarding,
        onboardingDismissedNotice: Boolean(onboarding?.dismissed && parsed.data.onboardingDismissed === '1'),
      });
    } catch (error) {
      if (error instanceof ActivityCursorError) {
        next(new AppError(400, 'invalid_request', 'Activity cursor is invalid.'));
        return;
      }
      next(error);
    }
  }

  router.get('/activity/feed', (req, res, next) => activityFeedRequest(req, res, next, true));

  router.get('/activity', (req, res, next) => activityFeedRequest(req, res, next, false));

  router.get('/v1/onboarding/status', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before viewing onboarding.'));
      return;
    }
    if (!dependencies.onboarding) {
      res.status(404).json({ error: { code: 'not_found', message: 'Onboarding is not available.' } });
      return;
    }
    try {
      const state = await dependencies.onboarding.getState(currentUser.userId);
      res.status(200).json(state ? { onboarding: createOnboardingView(state) } : { onboarding: null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/onboarding/dismiss', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !dependencies.onboarding) {
      next(new AppError(401, 'unauthorized', 'Sign in before updating onboarding.'));
      return;
    }
    try {
      await dependencies.onboarding.dismiss(currentUser.userId);
      if (req.get('accept')?.includes('application/json')) res.status(200).json({ dismissed: true });
      else res.redirect(303, '/activity?onboardingDismissed=1');
    } catch (error) { next(error); }
  });

  router.post('/onboarding/restore', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !dependencies.onboarding) {
      next(new AppError(401, 'unauthorized', 'Sign in before updating onboarding.'));
      return;
    }
    try {
      await dependencies.onboarding.restore(currentUser.userId);
      if (req.get('accept')?.includes('application/json')) res.status(200).json({ dismissed: false });
      else res.redirect(303, '/activity');
    } catch (error) { next(error); }
  });

  router.post('/onboarding/personal-map-viewed', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !dependencies.onboarding) {
      next(new AppError(401, 'unauthorized', 'Sign in before updating onboarding.'));
      return;
    }
    try {
      await dependencies.onboarding.markPersonalMapViewed(currentUser.userId);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.post('/activities/:activityId/like', async (req, res, next) => {
    const wantsJson = req.get('accept')?.toLowerCase().includes('application/json') ?? false;
    const fail = (status: number, code: string, message: string) => {
      if (wantsJson) {
        res.status(status).json({ error: { code, message } });
      } else {
        next(new AppError(status, code === 'forbidden' ? 'unauthorized' : 'invalid_request', message));
      }
    };
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      fail(401, 'unauthorized', 'Sign in before sending a Like.');
      return;
    }
    const parsedActivityId = pilotUserIdSchema.safeParse(req.params.activityId);
    if (!parsedActivityId.success) {
      fail(400, 'invalid_request', 'Activity ID is invalid.');
      return;
    }
    if (!dependencies.activity) throw new Error('Activity service is not configured.');
    try {
      const result = await dependencies.activity.toggleLike({
        viewerUserId: currentUser.userId,
        activityId: parsedActivityId.data,
      });
      if (wantsJson) {
        res.status(200).json(result);
      } else {
        res.redirect(303, '/activity');
      }
    } catch (error) {
      if (error instanceof ActivityNotFoundError) {
        fail(404, 'not_found', 'Activity not found.');
        return;
      }
      if (error instanceof SelfLikeError) {
        fail(403, 'forbidden', 'You cannot send a Like to your own activity.');
        return;
      }
      next(error);
    }
  });

  for (const action of ['follow', 'unfollow'] as const) {
    router.post(`/pilots/:userId/${action}`, async (req, res, next) => {
      const currentUser = res.locals.currentUser;
      if (!currentUser) {
        next(new AppError(401, 'unauthorized', 'Sign in before following pilots.'));
        return;
      }
      const parsedUserId = pilotUserIdSchema.safeParse(req.params.userId);
      if (!parsedUserId.success) {
        next(new AppError(400, 'invalid_request', 'Pilot ID is invalid.'));
        return;
      }
      if (parsedUserId.data === currentUser.userId) {
        next(new AppError(400, 'invalid_request', 'You cannot follow yourself.'));
        return;
      }
      if (!dependencies.follow) throw new Error('Follow service is not configured.');
      try {
        const body = formBody(req.body);
        if (action === 'follow') {
          await dependencies.follow.follow({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data });
        } else {
          await dependencies.follow.unfollow({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data });
        }
        res.redirect(303, followReturnTo(body.returnTo, `/pilots/${parsedUserId.data}`));
      } catch (error) {
        if (error instanceof PilotNotFoundError) {
          next(new AppError(404, 'invalid_request', error.message));
          return;
        }
        next(error);
      }
    });
  }

  router.get('/arena/:countryCode/:arenaSlug', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const arena = await dependencies.arenas.getByRoute(req.params.countryCode, req.params.arenaSlug);
      if (!arena) {
        next();
        return;
      }
      const selection = mapPagePeriod(req.query);
      if (req.query.view !== undefined && req.query.view !== 'following') {
        throw new AppError(400, 'invalid_request', 'Arena view is invalid.');
      }
      const viewSuffix = req.query.view === 'following'
        ? `${selection.suffix ? `${selection.suffix}&` : '?'}view=following`
        : selection.suffix;
      const mapHref = `${arena.path}${viewSuffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: req.query.view === 'following' ? 'following' : 'competitive', period: selection.period, location: arena.name, mapHref,
        ...(arena.arenaType === 'launch'
          ? { focusArenaSourceId: arena.sourceId }
          : { arenaSourceId: arena.sourceId }),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.adminFlights || !dependencies.renderAdminPage) {
      throw new Error('Admin dependencies are not configured.');
    }

    try {
      const [flightRows, queueSummary] = await Promise.all([
        dependencies.adminFlights.listRecentFlights(),
        dependencies.uploadQueue?.queueSummary(),
      ]);
      res.status(200).type('html').send(await dependencies.renderAdminPage({
        currentUser,
        flights: flightRows,
        queueSummary,
        reprocessSuccess: req.query.reprocess === 'success',
        reprocessError: req.query.reprocess === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/flight-processing', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (
      !dependencies.uploadQueue
      || !dependencies.workerControl
      || !dependencies.flightProcessingControl
      || !dependencies.renderAdminFlightProcessingPage
    ) {
      throw new Error('Admin flight processing dependencies are not configured.');
    }

    try {
      const [queueSummary, workerControlState, workerStatuses, nPointSolverState] = await Promise.all([
        dependencies.uploadQueue.queueSummary(),
        dependencies.workerControl.getState(),
        dependencies.workerControl.listStatuses(),
        dependencies.flightProcessingControl.getNPointSolverState(),
      ]);
      res.status(200).type('html').send(await dependencies.renderAdminFlightProcessingPage({
        currentUser,
        queueSummary,
        workerControlState,
        workers: workerStatuses.map((status) => ({
          ...status,
          heartbeat: new Date(status.heartbeatAt).toISOString(),
          online: Date.now() - status.heartbeatAt <= WORKER_STATUS_TTL_SECONDS * 1_000,
        })),
        nPointSolverState,
        workerControlSuccess: req.query.worker === 'paused' || req.query.worker === 'running',
        workerControlError: req.query.worker === 'error',
        solverControlSuccess: req.query.solver === 'enabled' || req.query.solver === 'disabled',
        solverControlError: req.query.solver === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/worker-control', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.workerControl) throw new Error('Admin dependencies are not configured.');

    const parsed = z.object({ state: z.enum(['running', 'paused']) }).strict().safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/flight-processing?worker=error');
      return;
    }

    try {
      await dependencies.workerControl.setState(parsed.data.state);
      res.redirect(303, `/admin/flight-processing?worker=${parsed.data.state}`);
    } catch {
      res.redirect(303, '/admin/flight-processing?worker=error');
    }
  });

  router.post('/admin/flight-processing/n-point-solver', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.flightProcessingControl) {
      throw new Error('Admin flight processing dependencies are not configured.');
    }

    const parsed = z.object({ state: z.enum(['enabled', 'disabled']) }).strict().safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/flight-processing?solver=error');
      return;
    }

    try {
      await dependencies.flightProcessingControl.setNPointSolverState(parsed.data.state);
      res.redirect(303, `/admin/flight-processing?solver=${parsed.data.state}`);
    } catch {
      res.redirect(303, '/admin/flight-processing?solver=error');
    }
  });

  router.get('/admin/map-settings', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.renderAdminMapSettingsPage) {
      throw new Error('Admin map settings dependencies are not configured.');
    }

    try {
      res.status(200).type('html').send(await dependencies.renderAdminMapSettingsPage({
        currentUser,
        settings: territoryTileSettings.get(),
        saveSuccess: req.query.save === 'success',
        saveError: req.query.save === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/map-settings', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.renderAdminMapSettingsPage) {
      throw new Error('Admin map settings dependencies are not configured.');
    }

    const parsed = territoryTileSettingsSchema.safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/map-settings?save=error');
      return;
    }

    try {
      territoryTileSettings.update({
        personal: {
          minimumZoom: parsed.data.personalMinimumZoom,
          maximumZoom: parsed.data.personalMaximumZoom,
        },
        competition: {
          minimumZoom: parsed.data.competitionMinimumZoom,
          maximumZoom: parsed.data.competitionMaximumZoom,
        },
      });
      res.redirect(303, '/admin/map-settings?save=success');
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/flights/:flightId/reprocess', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.adminFlights) throw new Error('Admin dependencies are not configured.');
    if (!z.string().uuid().safeParse(req.params.flightId).success) {
      res.redirect(303, '/admin?reprocess=error');
      return;
    }

    try {
      const outcome = await dependencies.adminFlights.reprocessFlight({ flightId: req.params.flightId });
      res.redirect(303, outcome.status === 'completed' ? '/admin?reprocess=success' : '/admin?reprocess=error');
    } catch (error) {
      console.error('Unable to reprocess flight claims', error);
      res.redirect(303, '/admin?reprocess=error');
    }
  });

  router.post('/signup', async (req, res) => {
    const wantsJson = req.get('accept')?.toLowerCase().includes('application/json') ?? false;
    const body = formBody(req.body);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const message = 'Enter a valid email, an optional display name of up to 48 characters, and a password of 12 to 128 characters.';
      if (wantsJson) {
        res.status(422).json({ error: { code: 'invalid_request', message } });
        return;
      }
      await render(res, dependencies.renderPage, 422, {
        currentUser: null,
        signupError: message,
        signupEmail: typeof body.email === 'string' ? body.email : '',
        signupDisplayName: typeof body.displayName === 'string' ? body.displayName : '',
      });
      return;
    }

    try {
      const session = await dependencies.auth.signup({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.displayName || undefined,
      });
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      if (wantsJson) {
        res.status(200).json({ ok: true });
        return;
      }
      res.redirect(303, '/activity?onboardingStep=first-flight');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'duplicate_email') {
        const message = 'An account with that email already exists.';
        if (wantsJson) {
          res.status(409).json({ error: { code: 'duplicate_email', message } });
          return;
        }
        await render(res, dependencies.renderPage, 409, {
          currentUser: null,
          signupError: message,
          signupEmail: parsed.data.email,
          signupDisplayName: parsed.data.displayName,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/login', async (req, res) => {
    const wantsJson = req.get('accept')?.toLowerCase().includes('application/json') ?? false;
    const body = formBody(req.body);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const message = 'Email or password is incorrect.';
      if (wantsJson) {
        res.status(401).json({ error: { code: 'invalid_credentials', message } });
        return;
      }
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        loginError: message,
        loginEmail: typeof body.email === 'string' ? body.email : '',
      });
      return;
    }

    try {
      const session = await dependencies.auth.login(parsed.data);
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      if (wantsJson) {
        res.status(200).json({ ok: true });
        return;
      }
      res.redirect(303, '/');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'invalid_credentials') {
        const message = 'Email or password is incorrect.';
        if (wantsJson) {
          res.status(401).json({ error: { code: 'invalid_credentials', message } });
          return;
        }
        await render(res, dependencies.renderPage, 401, {
          currentUser: null,
          loginError: message,
          loginEmail: parsed.data.email,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/logout', async (_req, res) => {
    if (res.locals.sessionToken) await dependencies.auth.logout(res.locals.sessionToken);
    res.setHeader('set-cookie', dependencies.cookie.clear());
    res.redirect(303, '/');
  });

  router.post('/profile/territory-color', async (req, res) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        territoryColorError: 'Sign in before changing your map color.',
      });
      return;
    }

    const territoryColor = normalizeTerritoryColor(formBody(req.body).territoryColor);
    if (!territoryColor) {
      await render(res, dependencies.renderPage, 422, {
        currentUser,
        territoryColorError: 'Choose a valid six-digit hex color.',
      });
      return;
    }

    await dependencies.profiles.updateTerritoryColor({ userId: currentUser.userId, territoryColor });
    res.redirect(303, dashboardSuccessRedirect(formBody(req.body).returnTo, 'territoryColor'));
  });

  router.get('/profile/glider/search', async (req, res, next) => {
    if (!res.locals.currentUser) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Sign in to search the glider catalog.' } });
      return;
    }
    try {
      if (!dependencies.profiles.searchGliderModels) throw new Error('Glider catalog is unavailable.');
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json(await dependencies.profiles.searchGliderModels(q));
    } catch (error) {
      next(error);
    }
  });

  router.post('/profile/glider', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) { res.redirect(303, '/login'); return; }
    const body = formBody(req.body);
    const draft = {
      modelId: typeof body.gliderModelId === 'string' ? body.gliderModelId : '',
      manufacturer: typeof body.manufacturer === 'string' ? body.manufacturer : '',
      model: typeof body.model === 'string' ? body.model : '',
      size: typeof body.size === 'string' ? body.size : '',
      year: typeof body.year === 'string' ? body.year.trim() : '',
      competitionId: typeof body.competitionId === 'string' ? body.competitionId : '',
      hours: typeof body.hours === 'string' ? body.hours.trim() : '',
    };
    try {
      if (!dependencies.profiles.saveGliderDetails) throw new Error('Glider profile is unavailable.');
      if (!/^\d{4}$/.test(draft.year)) {
        throw new GliderValidationError('Enter a four-digit glider year.');
      }
      if (!/^\d+(?:\.\d)?$/.test(draft.hours)) {
        throw new GliderValidationError('Enter nonnegative flight hours with no more than one decimal place.');
      }
      await dependencies.profiles.saveGliderDetails({
        userId: currentUser.userId,
        gliderModelId: draft.modelId,
        year: Number(draft.year),
        competitionId: draft.competitionId,
        hours: Number(draft.hours),
        resetHours: body.resetHours === 'true' ? true : body.resetHours === 'false' ? false : null,
      });
      res.redirect(303, '/profile');
    } catch (error) {
      if (!(error instanceof GliderValidationError)) {
        next(error);
        return;
      }
      try {
        const rendered = await renderCurrentProfile(res, currentUser, 422, {
          ...draft,
          error: error.message,
          isOpen: true,
        });
        if (!rendered) next();
      } catch (renderError) {
        next(renderError);
      }
    }
  });

  return router;
}
