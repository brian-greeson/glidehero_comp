# Live Map Flight Aids Implementation Plan

> Execute these checkbox-tracked tasks in order, preserving the test and verification checkpoints for each slice.

**Goal:** Add optional neutral claim-grid outlines, foreground position following, and one browser-local segmented trail to Global, Personal, and Arena maps.

**Architecture:** PostGIS generates grid cells from the configured EPSG:6933 claim grid through authenticated viewport and Arena endpoints. Focused browser modules own grid requests, custom MapLibre controls, trail storage/rendering, and foreground geolocation; a shared initializer adds them to each existing map without changing coverage, territory, scoring, or period behavior.

**Tech Stack:** TypeScript 7, Express 5, Drizzle ORM 1.0 RC, PostgreSQL/PostGIS, MapLibre GL JS 5.16, browser Geolocation and Web Storage APIs, Vitest 4.

---

## File Structure

### Backend

- Create `src/domain/territory/mapGridGeoJson.ts`: shared grid feature and GeoJSON contracts.
- Create `src/services/mapGridService.ts`: PostGIS viewport generation, response-size enforcement, and Arena cell projection.
- Modify `src/web/webRouter.ts`: authenticated viewport and Arena grid routes.
- Modify `src/index.ts`: construct and inject `MapGridService`.
- Create `test/integration/mapGridService.integration.test.ts`: PostGIS alignment, antimeridian, size-limit, and Arena-membership coverage.
- Modify `test/unit/webRouter.test.ts`: route authentication, validation, success, limit, and Arena 404 contracts.
- Modify `test/integration/webFlow.integration.test.ts`: provide the new router dependency.

### Browser

- Create `public/scripts/mapButtonControl.js`: one accessible reusable MapLibre button control.
- Create `public/scripts/mapGridApi.js`: canonical grid endpoint URL builders.
- Create `public/scripts/mapGridOverlay.js`: grid toggle, zoom gate, request cancellation, caching, and neutral line layer.
- Create `public/scripts/mapTrailStore.js`: versioned single-trail local storage and segmentation.
- Create `public/scripts/mapTrailLayer.js`: segmented trail and current-position MapLibre sources/layers.
- Create `public/scripts/mapLocationTracker.js`: geolocation watch, 100-meter filtering, follow/pan state, visibility gaps, and clear control.
- Create `public/scripts/mapFlightAids.js`: shared composition entry point.
- Create `src/views/components/mapFlightAidStatus.vto`: dedicated accessible map-local status region.
- Modify `public/scripts/competitionCoverageController.js`: install flight aids on Global and Arena maps.
- Modify `public/scripts/personalDashboard.js`: install flight aids on Personal maps.
- Modify `src/views/pages/global.vto`: render the shared status component.
- Modify `src/views/pages/personal.vto`: remove stubs and render the shared status component.
- Modify `src/views/pages/arena.vto`: render the shared status component.
- Modify `public/styles/app.css`: control states, accuracy dot, status toast, and touch sizing.

### Browser Tests

- Create `test/unit/mapGridOverlay.test.ts`: URL, zoom, toggle, Arena cache, move, and stale-response behavior.
- Create `test/unit/mapTrailStore.test.ts`: restore, append, segment, corrupt data, quota, and clear behavior.
- Create `test/unit/mapLocationTracker.test.ts`: accuracy, following, manual pan, visibility, errors, and clear behavior.
- Modify `test/unit/dashboardControllers.test.ts`: Global and Personal composition.
- Modify `test/unit/arena.test.ts`: Arena composition.
- Modify `test/unit/dashboardViews.test.ts`: shared status markup and removal of Personal stubs.
- Modify `test/unit/dashboardStyles.test.ts`: flight-aid control and mobile layout contracts.

---

### Task 1: Deliver the Viewport Grid as a Thin Backend Slice

**Files:**
- Create: `src/domain/territory/mapGridGeoJson.ts`
- Create: `src/services/mapGridService.ts`
- Create: `test/integration/mapGridService.integration.test.ts`
- Modify: `src/web/webRouter.ts`
- Modify: `src/index.ts`
- Modify: `test/unit/webRouter.test.ts`
- Modify: `test/integration/webFlow.integration.test.ts`

- [ ] **Step 1: Write failing PostGIS tests for aligned viewport cells and the response limit**

Create `test/integration/mapGridService.integration.test.ts` with a real database and a deliberately small limit:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMapGridService } from '../../src/services/mapGridService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
afterAll(async () => { if (database) await database.pool.end(); });

describe('MapGridService with PostGIS', () => {
  it('returns configured EPSG:6933 cells intersecting a viewport', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 10 });
    const result = await service.getViewport({ west: 0, south: 0, east: 0.01, north: 0.01 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected a grid result.');
    expect(result.geojson.features).not.toHaveLength(0);
    expect(result.geojson.features[0]?.properties).toMatchObject({ cellSize: 1_000 });
    expect(result.geojson.features[0]?.geometry.type).toBe('Polygon');
  });

  it('rejects a viewport that would exceed the configured cell limit', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 1 });
    await expect(service.getViewport({ west: 0, south: 0, east: 1, north: 1 }))
      .resolves.toEqual({ status: 'too_large' });
  });

  it('deduplicates cells across an antimeridian-split viewport', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 5_000 });
    const result = await service.getViewport({ west: 179.99, south: 0, east: -179.99, north: 0.01 });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected a grid result.');
    const ids = result.geojson.features.map(({ properties }) => `${properties.x}:${properties.y}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Add failing HTTP contract tests for `GET /v1/grid`**

In `test/unit/webRouter.test.ts`, import `MapGridService`, add a dependency stub, pass it to every `createWebRouter` call, and add this focused test:

```ts
const mapGrid: MapGridService = {
  getViewport: vi.fn(async () => ({
    status: 'ok',
    geojson: { type: 'FeatureCollection', features: [] },
  })),
};

it('protects and validates the viewport grid endpoint', async () => {
  const { app, mapGrid } = dependencies();
  await withServer(app, async (baseUrl) => {
    expect((await fetch(`${baseUrl}/v1/grid?west=-107&south=39&east=-105&north=41`)).status).toBe(401);

    const invalid = await fetch(`${baseUrl}/v1/grid?west=nope&south=39&east=-105&north=41`, {
      headers: { cookie: 'glidehero_session=valid-token' },
    });
    expect(invalid.status).toBe(400);

    const valid = await fetch(`${baseUrl}/v1/grid?west=-107&south=39&east=-105&north=41`, {
      headers: { cookie: 'glidehero_session=valid-token' },
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get('content-type')).toContain('application/geo+json');
    expect(mapGrid.getViewport).toHaveBeenCalledWith({ west: -107, south: 39, east: -105, north: 41 });
  });
});
```

Also make the stub return `{ status: 'too_large' }` in a separate assertion and expect status `422` with code `grid_viewport_too_large`.

- [ ] **Step 3: Run the new tests and verify they fail for missing grid contracts**

Run:

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run test/integration/mapGridService.integration.test.ts
./node_modules/.bin/vitest run test/unit/webRouter.test.ts
```

Expected: FAIL because `mapGridService.ts`, `MapGridService`, and `/v1/grid` do not exist.

- [ ] **Step 4: Define the shared GeoJSON contract**

Create `src/domain/territory/mapGridGeoJson.ts`:

```ts
export type MapGridCellFeature = {
  type: 'Feature';
  properties: { cellSize: number; x: number; y: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

export type MapGridGeoJson = {
  type: 'FeatureCollection';
  features: MapGridCellFeature[];
};

export const emptyMapGridGeoJson = (): MapGridGeoJson => ({
  type: 'FeatureCollection',
  features: [],
});
```

- [ ] **Step 5: Implement bounded viewport generation in `MapGridService`**

Create `src/services/mapGridService.ts` with a `LIMIT maxViewportCells + 1` query, convert rows to GeoJSON in TypeScript, and never aggregate an unbounded response:

```ts
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { MapGridCellFeature, MapGridGeoJson } from '../domain/territory/mapGridGeoJson.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

type StoredCell = {
  x: number;
  y: number;
  geometry: MapGridCellFeature['geometry'];
};

export type ViewportGridResult =
  | { status: 'ok'; geojson: MapGridGeoJson }
  | { status: 'too_large' };

export interface MapGridService {
  getViewport(bounds: ViewportBounds): Promise<ViewportGridResult>;
}

function geojson(rows: StoredCell[], cellSize: number): MapGridGeoJson {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      properties: { cellSize, x: row.x, y: row.y },
      geometry: row.geometry,
    })),
  };
}

export function createMapGridService(
  database: Database,
  options: { cellSize: number; maxViewportCells?: number },
): MapGridService {
  const { cellSize, maxViewportCells = 5_000 } = options;
  return {
    async getViewport(bounds) {
      const result = await database.execute<StoredCell>(sql`
        WITH ${viewportCtes(bounds)},
        cells AS (
          SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom
          FROM viewport_parts viewport
          CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport.geometry) AS grid(geom, x, y)
          WHERE ST_Intersects(grid.geom, viewport.geometry)
        )
        SELECT x, y, ST_AsGeoJSON(ST_Transform(geom, 4326))::jsonb AS geometry
        FROM cells
        ORDER BY x, y
        LIMIT ${maxViewportCells + 1}
      `);
      if (result.rows.length > maxViewportCells) return { status: 'too_large' };
      return { status: 'ok', geojson: geojson(result.rows, cellSize) };
    },
  };
}
```

- [ ] **Step 6: Add the authenticated viewport route and dependency wiring**

In `src/web/webRouter.ts`, add `mapGrid: MapGridService` to dependencies and register the route after `/v1/personal-stats`:

```ts
router.get('/v1/grid', async (req, res, next) => {
  if (!res.locals.currentUser) {
    next(new AppError(401, 'unauthorized', 'Sign in to view the map grid.'));
    return;
  }
  const viewport = viewportBoundsSchema.safeParse(req.query);
  if (!viewport.success) {
    res.status(400).json({ error: { code: 'invalid_request', message: 'Grid requires valid viewport bounds.' } });
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
```

In `src/index.ts`, construct and inject the service:

```ts
import { createMapGridService } from './services/mapGridService.js';

const mapGrid = createMapGridService(db, { cellSize: config.gridClaimCellSize });

createWebRouter({
  auth,
  cookie,
  igcFiles,
  profiles,
  gridClaim,
  mapGrid,
  coverage: monthlyCoverage,
  arenas,
  renderPage: createPageRenderer({ mapTilerApiKey: config.mapTilerApiKey }),
  adminEmails: config.adminEmails,
  adminFlights,
  renderAdminPage: createAdminPageRenderer(),
});
```

Add a `mapGrid` stub to `test/integration/webFlow.integration.test.ts` using `createMapGridService(testDatabase.db, { cellSize: 1_000 })`.

- [ ] **Step 7: Run the focused backend tests**

Run:

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run test/integration/mapGridService.integration.test.ts
./node_modules/.bin/vitest run test/unit/webRouter.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the viewport grid slice**

```bash
git add src/domain/territory/mapGridGeoJson.ts src/services/mapGridService.ts src/web/webRouter.ts src/index.ts test/integration/mapGridService.integration.test.ts test/integration/webFlow.integration.test.ts test/unit/webRouter.test.ts
git commit -m "Add viewport map grid endpoint"
```

---

### Task 2: Deliver the Arena Grid Backend Slice

**Files:**
- Modify: `src/services/mapGridService.ts`
- Modify: `src/web/webRouter.ts`
- Modify: `test/integration/mapGridService.integration.test.ts`
- Modify: `test/unit/webRouter.test.ts`

- [ ] **Step 1: Add a failing integration test for exact Arena membership**

Append a test that inserts two Arena cells plus a different-size row, then expects only the configured-size cells:

```ts
it('returns only stored cells for the requested Arena and configured size', async () => {
  const arena = await database.pool.query<{ id: string }>(`
    INSERT INTO launch_areas (
      source_id, name, country, state, city, location, altitude_meters, timezone, area
    ) VALUES (
      745, 'Flight Aid Arena', 'United States', 'Colorado', 'Boulder',
      ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
      ST_Multi(ST_MakeEnvelope(0, 0, 2000, 1000, 6933))
    ) RETURNING id
  `);
  const launchAreaId = arena.rows[0]?.id;
  if (!launchAreaId) throw new Error('Expected an Arena.');
  await database.pool.query(`
    INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y) VALUES
      ($1, 1000, 0, 0), ($1, 1000, 1, 0), ($1, 500, 99, 99)
  `, [launchAreaId]);

  const result = await createMapGridService(database.db, { cellSize: 1_000 })
    .getArena({ launchAreaId });
  expect(result.features.map(({ properties }) => [properties.x, properties.y]))
    .toEqual([[0, 0], [1, 0]]);
});
```

- [ ] **Step 2: Add failing Arena route tests**

In `test/unit/webRouter.test.ts`, make `arenas.getBySourceId` return the existing `arena` fixture and assert:

```ts
const response = await fetch(`${baseUrl}/v1/arenas/745/grid`, {
  headers: { cookie: 'glidehero_session=valid-token' },
});
expect(response.status).toBe(200);
expect(mapGrid.getArena).toHaveBeenCalledWith({ launchAreaId: arena.id });
```

Extend the Task 1 `mapGrid` stub with `getArena: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))`. Add assertions for anonymous `401`, invalid source ID `404`, and unknown Arena `404` without calling `mapGrid.getArena`.

- [ ] **Step 3: Run the focused tests and verify the Arena slice fails**

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run test/integration/mapGridService.integration.test.ts
./node_modules/.bin/vitest run test/unit/webRouter.test.ts
```

Expected: FAIL because `MapGridService.getArena` and the Arena route are absent.

- [ ] **Step 4: Extend the service contract and add the real Arena query**

In `src/services/mapGridService.ts`, add the method to `MapGridService` and its returned object:

```ts
export interface MapGridService {
  getViewport(bounds: ViewportBounds): Promise<ViewportGridResult>;
  getArena(input: { launchAreaId: string }): Promise<MapGridGeoJson>;
}

async getArena({ launchAreaId }) {
  const result = await database.execute<StoredCell>(sql`
    SELECT
      cell.x::integer AS x,
      cell.y::integer AS y,
      ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
        cell.x * cell.cell_size,
        cell.y * cell.cell_size,
        (cell.x + 1) * cell.cell_size,
        (cell.y + 1) * cell.cell_size,
        6933
      ), 4326))::jsonb AS geometry
    FROM launch_area_cells cell
    WHERE cell.launch_area_id = ${launchAreaId}
      AND cell.cell_size = ${cellSize}
    ORDER BY cell.x, cell.y
  `);
  return geojson(result.rows, cellSize);
}
```

- [ ] **Step 5: Add the authenticated Arena grid route**

In `src/web/webRouter.ts`, register:

```ts
router.get('/v1/arenas/:sourceId/grid', async (req, res, next) => {
  if (!res.locals.currentUser) {
    next(new AppError(401, 'unauthorized', 'Sign in to view an Arena grid.'));
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
    const grid = await dependencies.mapGrid.getArena({ launchAreaId: arena.id });
    res.status(200).type('application/geo+json').send(grid);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 6: Run and commit the Arena backend slice**

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run test/integration/mapGridService.integration.test.ts
./node_modules/.bin/vitest run test/unit/webRouter.test.ts
npm run typecheck
git add src/services/mapGridService.ts src/web/webRouter.ts test/integration/mapGridService.integration.test.ts test/unit/webRouter.test.ts
git commit -m "Add Arena map grid endpoint"
```

Expected: tests and typecheck PASS; commit succeeds.

---

### Task 3: Add the Shared Browser Grid Overlay

**Files:**
- Create: `public/scripts/mapButtonControl.js`
- Create: `public/scripts/mapGridApi.js`
- Create: `public/scripts/mapGridOverlay.js`
- Create: `test/unit/mapGridOverlay.test.ts`

- [ ] **Step 1: Write failing tests for URLs and the accessible button control**

Create `test/unit/mapGridOverlay.test.ts` and assert the canonical paths and control state:

```ts
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { arenaGridUrl, viewportGridUrl } from '../../public/scripts/mapGridApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createMapButtonControl } from '../../public/scripts/mapButtonControl.js';

it('builds canonical viewport and Arena grid URLs', () => {
  const bounds = { getWest: () => -107, getSouth: () => 39, getEast: () => -105, getNorth: () => 41 };
  expect(viewportGridUrl(bounds)).toBe('/v1/grid?west=-107&south=39&east=-105&north=41');
  expect(arenaGridUrl('745')).toBe('/v1/arenas/745/grid');
});

it('creates an accessible MapLibre toggle control', () => {
  const button = { setAttribute: vi.fn(), addEventListener: vi.fn(), className: '', type: '', title: '', textContent: '' };
  const container = { className: '', append: vi.fn() };
  const documentRef = { createElement: vi.fn((tag: string) => tag === 'button' ? button : container) };
  const control = createMapButtonControl({ documentRef, label: 'Show grid', symbol: '▦', onClick: vi.fn() });
  expect(control.onAdd({})).toBe(container);
  expect(button.setAttribute).toHaveBeenCalledWith('aria-label', 'Show grid');
  control.setPressed(true);
  expect(button.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
});
```

- [ ] **Step 2: Add failing grid behavior tests**

Test these observable behaviors with a MapLibre stub: grid starts off, below zoom 11 reports `Zoom in to view grid.` without fetching, Global refreshes on `moveend`, turning off hides the line layer, and Arena fetches only once across repeated toggles. Use deferred responses to prove an older viewport response cannot overwrite a newer one.

```ts
const overlay = initializeMapGridOverlay({
  map,
  documentRef,
  fetchImpl,
  status: vi.fn(),
  arenaSourceId: null,
  minimumViewportZoom: 11,
});
await overlay.toggle();
expect(fetchImpl).not.toHaveBeenCalled();
expect(status).toHaveBeenCalledWith('Zoom in to view grid.');
```

- [ ] **Step 3: Run the grid browser test and verify it fails**

```bash
./node_modules/.bin/vitest run test/unit/mapGridOverlay.test.ts
```

Expected: FAIL because the three browser modules do not exist.

- [ ] **Step 4: Implement the reusable MapLibre button**

Create `public/scripts/mapButtonControl.js`:

```js
export function createMapButtonControl({ documentRef = document, label, symbol, onClick }) {
  const container = documentRef.createElement('div');
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group flight-aid-control';
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'flight-aid-button';
  button.textContent = symbol;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', onClick);
  container.append(button);
  return {
    onAdd() { return container; },
    onRemove() { container.remove?.(); },
    setPressed(pressed) { button.setAttribute('aria-pressed', String(pressed)); },
    setHidden(hidden) { container.hidden = hidden; },
    setLabel(nextLabel) { button.title = nextLabel; button.setAttribute('aria-label', nextLabel); },
  };
}
```

- [ ] **Step 5: Implement URL builders and grid rendering**

Create `public/scripts/mapGridApi.js`:

```js
export function viewportGridUrl(bounds) {
  const query = new URLSearchParams({
    west: String(bounds.getWest()), south: String(bounds.getSouth()),
    east: String(bounds.getEast()), north: String(bounds.getNorth()),
  });
  return `/v1/grid?${query}`;
}

export function arenaGridUrl(sourceId) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/grid`;
}
```

Create `public/scripts/mapGridOverlay.js` with exported IDs, a neutral line layer, `createLatestRequest`, zoom 11 gating for viewport maps, one cached Arena response, `visibility` toggling, and a returned `{ toggle, refresh, destroy }` API. The layer contract is:

```js
export const MAP_GRID_SOURCE_ID = 'map-flight-aid-grid';
export const MAP_GRID_LAYER_ID = 'map-flight-aid-grid-lines';

export const MAP_GRID_LAYER = {
  id: MAP_GRID_LAYER_ID,
  type: 'line',
  source: MAP_GRID_SOURCE_ID,
  paint: {
    'line-color': '#334155',
    'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 15, 1.4],
    'line-opacity': 0.72,
  },
};
```

Implement the controller around that layer with this state flow:

```js
export function initializeMapGridOverlay({
  map, documentRef = document, fetchImpl = window.fetch.bind(window), status,
  arenaSourceId = null, minimumViewportZoom = 11,
}) {
  let enabled = false;
  let arenaCache = null;
  const setVisible = (visible) => {
    if (map.getLayer?.(MAP_GRID_LAYER_ID)) {
      map.setLayoutProperty(MAP_GRID_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  };
  const setData = (data) => {
    const source = map.getSource?.(MAP_GRID_SOURCE_ID);
    if (source?.setData) source.setData(data);
    else {
      map.addSource(MAP_GRID_SOURCE_ID, { type: 'geojson', data });
      map.addLayer(MAP_GRID_LAYER);
    }
    setVisible(true);
  };
  const request = createLatestRequest(async ({ signal, isCurrent }, url) => {
    const response = await fetchImpl(url, {
      credentials: 'same-origin', headers: { accept: 'application/geo+json' }, signal,
    });
    if (response.status === 422) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    if (!response.ok) throw new Error(`Grid request failed with ${response.status}.`);
    const data = await response.json();
    if (!isCurrent() || !enabled) return;
    if (arenaSourceId) arenaCache = data;
    setData(data);
    status('');
  });
  async function refresh() {
    if (!enabled) return;
    if (arenaSourceId && arenaCache) { setData(arenaCache); return; }
    if (!arenaSourceId && map.getZoom() < minimumViewportZoom) {
      request.cancel();
      setVisible(false);
      status('Zoom in to view grid.');
      return;
    }
    try {
      await request.run(arenaSourceId ? arenaGridUrl(arenaSourceId) : viewportGridUrl(map.getBounds()));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setVisible(false);
      status(error?.code === 'too_large' ? 'Zoom in to view grid.' : 'Unable to load grid. Try again.');
    }
  }
  async function toggle() {
    enabled = !enabled;
    control.setPressed(enabled);
    control.setLabel(enabled ? 'Hide grid' : 'Show grid');
    if (!enabled) { request.cancel(); setVisible(false); status(''); return; }
    await refresh();
  }
  const control = createMapButtonControl({ documentRef, label: 'Show grid', symbol: '▦', onClick: toggle });
  const onMoveEnd = () => { if (enabled && !arenaSourceId) void refresh(); };
  map.on('moveend', onMoveEnd);
  return {
    control, toggle, refresh,
    destroy() { request.cancel(); map.off?.('moveend', onMoveEnd); },
  };
}
```

- [ ] **Step 6: Run and commit the browser grid module**

```bash
./node_modules/.bin/vitest run test/unit/mapGridOverlay.test.ts
git add public/scripts/mapButtonControl.js public/scripts/mapGridApi.js public/scripts/mapGridOverlay.js test/unit/mapGridOverlay.test.ts
git commit -m "Add shared map grid overlay"
```

Expected: test PASS; commit succeeds.

---

### Task 4: Add the Versioned Single-Trail Store

**Files:**
- Create: `public/scripts/mapTrailStore.js`
- Create: `test/unit/mapTrailStore.test.ts`

- [ ] **Step 1: Write failing storage and segmentation tests**

Create `test/unit/mapTrailStore.test.ts` with an in-memory Storage stub and cover:

```ts
it('restores one shared trail and appends separate segments', () => {
  const storage = memoryStorage();
  const first = createMapTrailStore({ storage });
  first.startSegment();
  first.append({ longitude: -106, latitude: 39, timestamp: 1000 });
  first.closeSegment();
  first.startSegment();
  first.append({ longitude: -105.9, latitude: 39.1, timestamp: 2000 });

  const restored = createMapTrailStore({ storage });
  expect(restored.snapshot().segments).toHaveLength(2);
  expect(restored.snapshot().segments[1]?.[0]?.longitude).toBe(-105.9);
});

it('starts a new segment after a timestamp gap', () => {
  const store = createMapTrailStore({ storage: memoryStorage(), gapMilliseconds: 60_000 });
  store.append({ longitude: -106, latitude: 39, timestamp: 1000 });
  store.append({ longitude: -105, latitude: 40, timestamp: 62_000 });
  expect(store.snapshot().segments).toHaveLength(2);
});
```

Also test: invalid JSON is removed, wrong versions are removed, malformed points are discarded, successful `clear()` returns `true`, a throwing `removeItem` returns `false`, and a throwing `setItem` retains the new point in memory while calling `onPersistenceError`.

- [ ] **Step 2: Run the trail-store test and verify it fails**

```bash
./node_modules/.bin/vitest run test/unit/mapTrailStore.test.ts
```

Expected: FAIL because `mapTrailStore.js` does not exist.

- [ ] **Step 3: Implement the versioned store**

Create `public/scripts/mapTrailStore.js` with this public contract:

```js
export const MAP_TRAIL_STORAGE_KEY = 'glidehero.mapTrail.v1';
export const MAP_TRAIL_VERSION = 1;

function validPoint(point) {
  return point
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
    && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.timestamp);
}

function readValidPayload(storage) {
  try {
    const raw = storage.getItem(MAP_TRAIL_STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw);
    if (payload?.version !== MAP_TRAIL_VERSION || !Array.isArray(payload.segments)) {
      storage.removeItem(MAP_TRAIL_STORAGE_KEY);
      return [];
    }
    const segments = payload.segments
      .filter(Array.isArray)
      .map((segment) => segment.filter(validPoint))
      .filter((segment) => segment.length > 0);
    if (segments.length !== payload.segments.length) {
      storage.setItem(MAP_TRAIL_STORAGE_KEY, JSON.stringify({ version: MAP_TRAIL_VERSION, segments }));
    }
    return segments;
  } catch {
    try { storage.removeItem(MAP_TRAIL_STORAGE_KEY); } catch { return []; }
    return [];
  }
}

export function createMapTrailStore({
  storage = window.localStorage,
  gapMilliseconds = 60_000,
  onPersistenceError = () => {},
} = {}) {
  let segments = readValidPayload(storage);
  let activeSegment = null;

  function persist() {
    try {
      storage.setItem(MAP_TRAIL_STORAGE_KEY, JSON.stringify({ version: MAP_TRAIL_VERSION, segments }));
    } catch (error) {
      onPersistenceError(error);
    }
  }

  return {
    snapshot: () => ({ version: MAP_TRAIL_VERSION, segments: structuredClone(segments) }),
    hasPoints: () => segments.some((segment) => segment.length > 0),
    startSegment() { activeSegment = []; segments.push(activeSegment); },
    closeSegment() { activeSegment = null; },
    append(point) {
      const last = segments.at(-1)?.at(-1);
      if (!activeSegment || (last && point.timestamp - last.timestamp > gapMilliseconds)) {
        activeSegment = [];
        segments.push(activeSegment);
      }
      activeSegment.push(point);
      persist();
    },
    clear() {
      segments = [];
      activeSegment = null;
      try {
        storage.removeItem(MAP_TRAIL_STORAGE_KEY);
        return true;
      } catch (error) {
        onPersistenceError(error);
        return false;
      }
    },
  };
}
```

The `clear()` boolean tells the controller whether persisted data was definitely removed. If it returns `false`, clear the rendered in-memory line but keep Clear Trail visible and show the storage error because the old payload may return after reload.

- [ ] **Step 4: Run and commit the trail store**

```bash
./node_modules/.bin/vitest run test/unit/mapTrailStore.test.ts
git add public/scripts/mapTrailStore.js test/unit/mapTrailStore.test.ts
git commit -m "Add browser-local map trail store"
```

Expected: test PASS; commit succeeds.

---

### Task 5: Render the Trail and Implement Foreground Location State

**Files:**
- Create: `public/scripts/mapTrailLayer.js`
- Create: `public/scripts/mapLocationTracker.js`
- Create: `test/unit/mapLocationTracker.test.ts`

- [ ] **Step 1: Write failing trail-renderer tests**

In `test/unit/mapLocationTracker.test.ts`, assert that segments become separate LineString features and the current position becomes a point:

```ts
expect(trailGeoJson({ segments: [
  [{ longitude: -106, latitude: 39, timestamp: 1 }, { longitude: -105.9, latitude: 39.1, timestamp: 2 }],
  [{ longitude: -105, latitude: 40, timestamp: 3 }],
] }).features).toHaveLength(1);

setCurrentPosition(map, { longitude: -106, latitude: 39 });
expect(map.getSource(MAP_POSITION_SOURCE_ID).setData).toHaveBeenCalledWith(
  expect.objectContaining({ geometry: { type: 'Point', coordinates: [-106, 39] } }),
);
```

Single-point segments remain stored but are omitted from line GeoJSON until a second point arrives.

- [ ] **Step 2: Write failing location state tests**

Use injected `geolocation`, `documentRef`, and a map-event harness. Cover these exact transitions:

```ts
await tracker.toggleLocation();
expect(geolocation.watchPosition).toHaveBeenCalledWith(
  expect.any(Function), expect.any(Function),
  { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
);

success({ coords: { longitude: -106, latitude: 39, accuracy: 25 }, timestamp: 1000 });
expect(store.append).toHaveBeenCalled();
expect(map.easeTo).toHaveBeenCalledWith({ center: [-106, 39], duration: 0 });

map.emit('dragstart');
success({ coords: { longitude: -105.9, latitude: 39.1, accuracy: 25 }, timestamp: 2000 });
expect(store.append).toHaveBeenCalledTimes(2);
expect(map.easeTo).toHaveBeenCalledTimes(1);

success({ coords: { longitude: 0, latitude: 0, accuracy: 101 }, timestamp: 3000 });
expect(store.append).toHaveBeenCalledTimes(2);
```

Also test: tapping while panned resumes following; tapping while following calls `clearWatch` and closes the segment; hidden/visible closes then starts a new segment; permission denial reports a message and stops; unsupported geolocation reports a message; clear removes rendered data but does not stop the watch.

- [ ] **Step 3: Run the location test and verify it fails**

```bash
./node_modules/.bin/vitest run test/unit/mapLocationTracker.test.ts
```

Expected: FAIL because the location and layer modules do not exist.

- [ ] **Step 4: Implement trail and position MapLibre layers**

Create `public/scripts/mapTrailLayer.js` with separate IDs and these paint contracts:

```js
export const MAP_TRAIL_SOURCE_ID = 'map-flight-aid-trail';
export const MAP_TRAIL_LAYER_ID = 'map-flight-aid-trail-line';
export const MAP_POSITION_SOURCE_ID = 'map-flight-aid-position';
export const MAP_POSITION_HALO_LAYER_ID = 'map-flight-aid-position-halo';
export const MAP_POSITION_DOT_LAYER_ID = 'map-flight-aid-position-dot';

export function trailGeoJson(snapshot) {
  return {
    type: 'FeatureCollection',
    features: snapshot.segments
      .filter((segment) => segment.length >= 2)
      .map((segment, index) => ({
        type: 'Feature', properties: { segment: index },
        geometry: { type: 'LineString', coordinates: segment.map((point) => [point.longitude, point.latitude]) },
      })),
  };
}

export function initializeTrailLayers(map, snapshot) {
  map.addSource(MAP_TRAIL_SOURCE_ID, { type: 'geojson', data: trailGeoJson(snapshot) });
  map.addLayer({
    id: MAP_TRAIL_LAYER_ID, type: 'line', source: MAP_TRAIL_SOURCE_ID,
    paint: { 'line-color': '#1769AA', 'line-width': 4, 'line-opacity': 0.9 },
  });
  map.addSource(MAP_POSITION_SOURCE_ID, {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: MAP_POSITION_HALO_LAYER_ID, type: 'circle', source: MAP_POSITION_SOURCE_ID,
    paint: { 'circle-radius': 12, 'circle-color': '#1769AA', 'circle-opacity': 0.18 },
  });
  map.addLayer({
    id: MAP_POSITION_DOT_LAYER_ID, type: 'circle', source: MAP_POSITION_SOURCE_ID,
    paint: {
      'circle-radius': 6, 'circle-color': '#1769AA',
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
    },
  });
}

export function renderTrail(map, snapshot) {
  map.getSource(MAP_TRAIL_SOURCE_ID)?.setData(trailGeoJson(snapshot));
}

export function setCurrentPosition(map, point = null) {
  map.getSource(MAP_POSITION_SOURCE_ID)?.setData({
    type: 'FeatureCollection',
    features: point ? [{
      type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    }] : [],
  });
}
```

This is a simple accuracy dot, not a heading or aircraft symbol.

- [ ] **Step 5: Implement the location state machine**

Create `public/scripts/mapLocationTracker.js` exporting `initializeMapLocationTracker`. Keep explicit state:

```js
let watchId = null;
let following = false;
let lastPosition = null;
let breakBeforeNextPoint = true;

function acceptPosition(position) {
  const { longitude, latitude, accuracy } = position.coords;
  if (![longitude, latitude, accuracy].every(Number.isFinite) || accuracy > 100) return;
  if (breakBeforeNextPoint) store.startSegment();
  breakBeforeNextPoint = false;
  const point = { longitude, latitude, timestamp: position.timestamp };
  store.append(point);
  lastPosition = point;
  renderTrail(map, store.snapshot());
  setCurrentPosition(map, point);
  clearControl.setHidden(false);
  if (following) map.easeTo({ center: [longitude, latitude], duration: 0 });
}

function stopTracking(message = '') {
  if (watchId !== null) geolocation.clearWatch(watchId);
  watchId = null;
  following = false;
  breakBeforeNextPoint = true;
  store.closeSegment();
  setCurrentPosition(map, null);
  locationControl.setPressed(false);
  locationControl.setLabel('Start location tracking');
  if (message) status(message);
}

function startTracking() {
  if (!geolocation?.watchPosition) {
    status('Location tracking is not supported by this browser.');
    return;
  }
  following = true;
  breakBeforeNextPoint = true;
  watchId = geolocation.watchPosition(
    acceptPosition,
    (error) => stopTracking(error?.code === 1
      ? 'Location permission was denied.'
      : 'Current location is unavailable.'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  );
  locationControl.setPressed(true);
  locationControl.setLabel('Stop location tracking');
}

function toggleLocation() {
  if (watchId === null) { startTracking(); return; }
  if (!following) {
    following = true;
    locationControl.setPressed(true);
    locationControl.setLabel('Stop location tracking');
    if (lastPosition) map.easeTo({ center: [lastPosition.longitude, lastPosition.latitude], duration: 0 });
    return;
  }
  stopTracking();
}

map.on('dragstart', () => {
  if (watchId === null) return;
  following = false;
  locationControl.setPressed(false);
  locationControl.setLabel('Resume following location');
});

documentRef.addEventListener('visibilitychange', () => {
  if (!documentRef.hidden || watchId === null) return;
  store.closeSegment();
  breakBeforeNextPoint = true;
});
```

Create `locationControl` with `Start location tracking`, `◎`, and `toggleLocation`. Create `clearControl` with `Clear trail`, `⌫`, and a handler that calls `store.clear()`, renders the empty snapshot without changing the current position or active watch, and keeps the control visible when `clear()` returns `false`. Return `{ locationControl, clearControl, toggleLocation, stopTracking }` for composition and tests.

- [ ] **Step 6: Run and commit the location slice**

```bash
./node_modules/.bin/vitest run test/unit/mapLocationTracker.test.ts test/unit/mapTrailStore.test.ts
git add public/scripts/mapTrailLayer.js public/scripts/mapLocationTracker.js test/unit/mapLocationTracker.test.ts
git commit -m "Add foreground map location trail"
```

Expected: tests PASS; commit succeeds.

---

### Task 6: Compose Flight Aids into Every Map

**Files:**
- Create: `public/scripts/mapFlightAids.js`
- Create: `src/views/components/mapFlightAidStatus.vto`
- Modify: `public/scripts/competitionCoverageController.js`
- Modify: `public/scripts/personalDashboard.js`
- Modify: `src/views/pages/global.vto`
- Modify: `src/views/pages/personal.vto`
- Modify: `src/views/pages/arena.vto`
- Modify: `test/unit/dashboardControllers.test.ts`
- Modify: `test/unit/arena.test.ts`
- Modify: `test/unit/dashboardViews.test.ts`

- [ ] **Step 1: Add failing controller composition tests**

Update the map harnesses so `on` and `once` retain multiple handlers. Add a `getZoom` stub and DOM element creation support required by custom controls. Then assert all maps install flight aids after load:

```ts
expect(harness.map.addControl).toHaveBeenCalledWith(expect.objectContaining({ onAdd: expect.any(Function) }), 'top-right');
```

For Arena, assert the grid request uses `/v1/arenas/745/grid`. For Global and Personal at zoom 11, assert it uses `/v1/grid?west=-107&south=39&east=-105&north=41`. Preserve existing assertions that Arena map movement does not refresh competition scoring and that Personal stats and Global leaderboard refresh behavior remains unchanged.

- [ ] **Step 2: Add failing view tests for the dedicated status region**

In `test/unit/dashboardViews.test.ts`, assert Global, Personal, and Arena HTML contain `data-map-flight-aid-status`, `role="status"`, and `aria-live="polite"`. Assert Personal no longer contains `data-stub="recenter-map"` or `data-stub="layer-selector"`.

- [ ] **Step 3: Run the focused composition tests and verify they fail**

```bash
./node_modules/.bin/vitest run test/unit/dashboardControllers.test.ts test/unit/arena.test.ts test/unit/dashboardViews.test.ts
```

Expected: FAIL because flight aids are not composed and the status component is absent.

- [ ] **Step 4: Add the reusable status component to all map templates**

Create `src/views/components/mapFlightAidStatus.vto`:

```vento
<p class="map-flight-aid-status" data-map-flight-aid-status role="status" aria-live="polite" hidden></p>
```

Include it inside each `.map-stage` in `global.vto`, `personal.vto`, and `arena.vto`. Remove the entire disabled `.map-actions` block from `personal.vto`.

- [ ] **Step 5: Implement the shared composition entry point**

Create `public/scripts/mapFlightAids.js`:

```js
import { initializeMapGridOverlay } from './mapGridOverlay.js';
import { initializeMapLocationTracker } from './mapLocationTracker.js';
import { createMapTrailStore } from './mapTrailStore.js';
import { initializeTrailLayers } from './mapTrailLayer.js';

export function initializeMapFlightAids({
  map,
  maplibre,
  mapElement,
  documentRef = document,
  fetchImpl = window.fetch.bind(window),
  navigatorRef = window.navigator,
  storage = window.localStorage,
} = {}) {
  const statusElement = documentRef.querySelector('[data-map-flight-aid-status]');
  const status = (message = '') => {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !message;
  };
  const store = createMapTrailStore({
    storage,
    onPersistenceError: () => status('Trail is visible, but new points cannot be saved.'),
  });
  initializeTrailLayers(map, store.snapshot());
  const location = initializeMapLocationTracker({
    map, maplibre, documentRef, geolocation: navigatorRef.geolocation, store, status,
  });
  const grid = initializeMapGridOverlay({
    map, documentRef, fetchImpl, status,
    arenaSourceId: mapElement.dataset.arenaSourceId || null,
  });
  map.addControl(grid.control, 'top-right');
  map.addControl(location.locationControl, 'top-right');
  map.addControl(location.clearControl, 'top-right');
  return { grid, location };
}
```

- [ ] **Step 6: Install the initializer after each map loads**

In `public/scripts/competitionCoverageController.js`, call the initializer at the beginning of the existing `load` callback, before boundary/coverage requests:

```js
initializeMapFlightAids({ map, maplibre, mapElement, documentRef, fetchImpl });
```

Make the same call in `public/scripts/personalDashboard.js` before loading Personal territory. Add `navigatorRef` and `storage` optional parameters to controller signatures and forward them to the initializer so unit tests never depend on real browser globals.

- [ ] **Step 7: Run and commit the map composition slice**

```bash
./node_modules/.bin/vitest run test/unit/dashboardControllers.test.ts test/unit/arena.test.ts test/unit/dashboardViews.test.ts
git add public/scripts/mapFlightAids.js public/scripts/competitionCoverageController.js public/scripts/personalDashboard.js src/views/components/mapFlightAidStatus.vto src/views/pages/global.vto src/views/pages/personal.vto src/views/pages/arena.vto test/unit/dashboardControllers.test.ts test/unit/arena.test.ts test/unit/dashboardViews.test.ts
git commit -m "Add flight aids to every map"
```

Expected: tests PASS; commit succeeds.

---

### Task 7: Finish Control Styling and Accessible Status Behavior

**Files:**
- Modify: `public/styles/app.css`
- Modify: `public/scripts/mapGridOverlay.js`
- Modify: `public/scripts/mapLocationTracker.js`
- Modify: `test/unit/dashboardStyles.test.ts`
- Modify: `test/unit/mapGridOverlay.test.ts`
- Modify: `test/unit/mapLocationTracker.test.ts`

- [ ] **Step 1: Add failing style and state-label tests**

In `test/unit/dashboardStyles.test.ts`, assert `.flight-aid-button` has a minimum `44px` touch target, pressed state is visually distinct, hidden controls use `[hidden] { display: none; }`, and the status toast stays above the mobile sheet.

In the browser-module tests, assert labels change exactly:

- Grid: `Show grid` / `Hide grid`.
- Location off: `Start location tracking`.
- Following: `Stop location tracking`.
- Panned: `Resume following location`.
- Clear: `Clear trail` and hidden when no points exist.

- [ ] **Step 2: Run focused tests and verify style/state assertions fail**

```bash
./node_modules/.bin/vitest run test/unit/dashboardStyles.test.ts test/unit/mapGridOverlay.test.ts test/unit/mapLocationTracker.test.ts
```

Expected: FAIL for missing CSS and incomplete control labels.

- [ ] **Step 3: Add focused control and status CSS**

In `public/styles/app.css`, remove obsolete `.map-actions` rules and add:

```css
.flight-aid-control[hidden] { display: none; }
.flight-aid-button {
  display: grid;
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  place-items: center;
  padding: 0;
  color: #0f172a;
  font-size: 1.2rem;
  line-height: 1;
}
.flight-aid-button[aria-pressed='true'] {
  color: #fff;
  background: var(--color-primary-strong);
}
.map-flight-aid-status {
  position: absolute;
  z-index: 5;
  right: 16px;
  bottom: 24px;
  max-width: min(20rem, calc(100% - 2rem));
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: 0.65rem;
  color: var(--color-text-strong);
  background: rgb(255 255 255 / 94%);
  box-shadow: 0 5px 18px rgb(15 23 42 / 18%);
}
.map-flight-aid-status[hidden] { display: none; }

@media (max-width: 900px) {
  .map-flight-aid-status { bottom: 92px; }
  .has-competition-breadcrumb .map-flight-aid-status { bottom: 308px; }
}
```

- [ ] **Step 4: Finish exact control labels and clear visibility**

Update `mapGridOverlay.js` and `mapLocationTracker.js` so every state change updates `aria-pressed`, `title`, and `aria-label` through `setPressed` and `setLabel`. Initialize Clear Trail from `store.hasPoints()` and update it after every accepted point and clear action.

- [ ] **Step 5: Run and commit the polish slice**

```bash
./node_modules/.bin/vitest run test/unit/dashboardStyles.test.ts test/unit/mapGridOverlay.test.ts test/unit/mapLocationTracker.test.ts
git add public/styles/app.css public/scripts/mapGridOverlay.js public/scripts/mapLocationTracker.js test/unit/dashboardStyles.test.ts test/unit/mapGridOverlay.test.ts test/unit/mapLocationTracker.test.ts
git commit -m "Polish map flight aid controls"
```

Expected: tests PASS; commit succeeds.

---

### Task 8: Run Full Verification and Perform the Real Browser Smoke Test

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run formatting and static verification**

```bash
git diff --check
npm run typecheck
npm run build
```

Expected: no diff errors; TypeScript and build PASS.

- [ ] **Step 2: Run the complete unit suite**

```bash
npm test
```

Expected: every unit test PASS.

- [ ] **Step 3: Run the complete integration suite with the real environment**

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run test/integration
```

Expected: every integration test PASS against the worktree database with PostGIS enabled.

- [ ] **Step 4: Start the app and verify the real browser flow**

```bash
npm run dev
```

Verify in desktop and a mobile viewport:

1. Global, Personal, and Arena show Grid and Location controls; Clear Trail is absent initially.
2. Global and Personal report `Zoom in to view grid.` below zoom 11 and draw neutral cells at zoom 11 or closer.
3. Arena draws only its stored cells at any zoom and reuses the first response after toggling off/on.
4. Existing coverage, period, selected pilot, leaderboard, Personal territory, and stats remain unchanged.
5. Denying location permission reports a concise message and leaves the map usable.
6. Allowing location displays only a blue dot/halo and begins a trail after two accepted points.
7. A fix worse than 100 meters does not move the dot or extend the trail.
8. Manual pan stops recentering but continues the trail; the next location-button tap resumes following.
9. Switching apps and returning begins a visibly separate segment.
10. Turning tracking off/on begins a visibly separate segment.
11. Navigation and reload preserve the trail but do not restart active tracking.
12. The same trail appears on all three maps.
13. Clear Trail removes all segments immediately, hides itself, and does not stop an active watch.

- [ ] **Step 5: Route any discovered defect back through its owning task**

If verification exposes a defect, return to the task that owns that behavior, add a failing regression test to that task's exact test file, implement the smallest correction, rerun that task's focused command, and use that task's explicit `git add` file list. Do not stage directories or unrelated user changes. If no correction is needed, do not create an empty commit.

```bash
git status --short
```

Expected: only files belonging to the failed task are modified before its correction commit.

- [ ] **Step 6: Record final evidence**

```bash
git status --short
git log --oneline -8
```

Expected: clean worktree and the viewport grid, Arena grid, browser grid, trail store, location tracker, map composition, and polish commits visible in order.
