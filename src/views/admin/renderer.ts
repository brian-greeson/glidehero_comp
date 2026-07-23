import { resolve } from 'node:path';
import vento from 'ventojs';
import type { TerritoryTileConfig } from '../../config/territoryTiles.js';
import type { AdminFlight, AdminUserFlight, AdminUserFlightSort } from '../../services/adminFlightService.js';
import type { AuthenticatedUser } from '../../services/authService.js';
import type { AdminUserDetail, AdminUserSummary } from '../../services/adminUserService.js';
import type { WorkerControlState, WorkerLiveState } from '../../services/workerControlService.js';

export type AdminWorkerStatus = {
  workerId: string;
  state: WorkerLiveState;
  currentJobId?: string;
  heartbeatAt: number;
  processedCount: number;
  failedCount: number;
  lastError?: string;
  heartbeat: string;
  online: boolean;
};

export type AdminPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  flights: AdminFlight[];
  queueSummary?: { queued: number; processing: number; failed: number; oldestQueuedAgeSeconds: number | null };
  workerControlState?: WorkerControlState;
  workers?: AdminWorkerStatus[];
  workerControlSuccess?: boolean;
  workerControlError?: boolean;
  reprocessSuccess?: boolean;
  reprocessError?: boolean;
}) => Promise<string>;

export type AdminAreaPageRenderer = (model: {
  currentUser: AuthenticatedUser;
}) => Promise<string>;

export type AdminMapSettingsPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  settings: TerritoryTileConfig;
  saveSuccess?: boolean;
  saveError?: boolean;
}) => Promise<string>;

export type AdminUserPageRenderer = (model: {
  currentUser: AuthenticatedUser;
  users: AdminUserSummary[];
  selectedUser?: AdminUserDetail;
  flights: AdminUserFlight[];
  deletableFlightCount: number;
  search: string;
  searchParam: string;
  flightSort: AdminUserFlightSort;
  flightDateSortUrl: string;
  uploadDateSortUrl: string;
  mode: 'empty' | 'create' | 'edit';
  successMessage?: string;
  errorMessage?: string;
}) => Promise<string>;

function createEnvironment() {
  return vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
}

export function createAdminPageRenderer(): AdminPageRenderer {
  const environment = createEnvironment();

  return async (model) => (
    await environment.run('admin/pages/admin.vto', {
      reprocessSuccess: false,
      reprocessError: false,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: undefined,
      pageScript: undefined,
      queueSummary: undefined,
      workerControlState: undefined,
      workers: [],
      workerControlSuccess: false,
      workerControlError: false,
      ...model,
    })
  ).content;
}

export function createAdminMapSettingsPageRenderer(): AdminMapSettingsPageRenderer {
  const environment = createEnvironment();

  return async (model) => (
    await environment.run('admin/pages/adminMapSettings.vto', {
      saveSuccess: false,
      saveError: false,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: undefined,
      pageScript: undefined,
      ...model,
    })
  ).content;
}

export function createAdminUserPageRenderer(): AdminUserPageRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run('admin/pages/adminUsers.vto', {
      selectedUser: undefined,
      successMessage: undefined,
      errorMessage: undefined,
      isDashboard: false,
      isErrorPage: false,
      dashboardScript: '',
      pageStylesheet: '/styles/adminUserManagement.css',
      pageScript: '/scripts/admin/userManagement.js',
      ...model,
    })
  ).content;
}

export function createAdminAreaPageRenderer(options: { mapTilerApiKey: string }): AdminAreaPageRenderer {
  const environment = createEnvironment();
  return async (model) => (
    await environment.run('admin/pages/adminAreas.vto', {
      mapTilerStyleUrl: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${options.mapTilerApiKey}`,
      ...model,
    })
  ).content;
}
