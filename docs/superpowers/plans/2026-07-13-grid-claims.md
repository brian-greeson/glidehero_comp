# Grid Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add metre-based user grid claims, grid-cell enclosure detection, and `poly`/`grid` territory selection while preserving FreePolygonClaim.

**Architecture:** `GridClaimService` is an independent PostGIS-backed variation. It derives crossed EPSG:6933 cells from ordered track segments, detects holes in the union of current-flight cells, and stores the winner per `(cellSize, x, y)`. The existing endpoint selects the polygon or grid projection.

**Tech Stack:** TypeScript 7, Vitest 4, Drizzle ORM/Kit 1.0 RC, PostgreSQL/PostGIS, Express 5, Zod 4.

## Global Constraints

- Use Drizzle ORM and Drizzle Kit 1.0-or-later APIs only.
- Use EPSG:6933 for grid calculations; `cellSize` is a positive whole number of metres.
- Only direct cells from the current flight form enclosures; corner-only contact never encloses a cell.
- Direct claims use the latest segment endpoint timestamp. Enclosed claims use the final first-claimed boundary-cell timestamp.
- Keep FreePolygonClaim data, projection, and default API behavior intact. Do not add a generic registry.
- `claimMonth` and competition grid claims are out of scope.

---

### Task 1: Configuration, storage, and GridClaim GeoJSON

**Files:**
- Modify: `src/config.ts`, `src/db/schema.ts`, `src/db/relations.ts`, `src/db/types.ts`, `.env.example`, `README.md`
- Create: `src/domain/territory/gridClaimGeoJson.ts`, `test/unit/gridClaimGeoJson.test.ts`
- Modify: `test/unit/config.test.ts`, `test/unit/schema.test.ts`, `test/integration/schema.integration.test.ts`

**Interfaces:**

```ts
type AppConfig = { gridClaimCellSize: number /* existing fields retained */ };

type GridClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  }>;
};

function emptyGridClaimGeoJson(): GridClaimGeoJson;
```

Add required `GRID_CLAIM_CELL_SIZE` as `z.coerce.number().int().min(1)` and expose it as `gridClaimCellSize`. Set `.env.example` to `GRID_CLAIM_CELL_SIZE=1000` and update every valid config test fixture.

Add `userGridClaims` mapped to `user_grid_claims`:

```ts
export const userGridClaims = pgTable(
  'user_grid_claims',
  {
    cellSize: integer('cell_size').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    claimFlight: uuid('claim_flight').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    claimUser: uuid('claim_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellSize, table.x, table.y] }),
    index('user_grid_claims_claim_user_cell_size_idx').on(table.claimUser, table.cellSize),
    index('user_grid_claims_claim_flight_idx').on(table.claimFlight),
  ],
);
```

Add user/flight relations, `GridClaimRow`, GeoJSON empty-factory coverage, config validation coverage, and database-level schema assertions for the table, six required columns, composite primary key, cascading foreign keys, and two named indexes.

**TDD cycle:** Write the config, GeoJSON, and schema tests; run `npm test -- test/unit/config.test.ts test/unit/schema.test.ts test/unit/gridClaimGeoJson.test.ts` to see failures; implement the minimal files; rerun that command, `npm run typecheck`, and `TEST_DATABASE_URL=postgres://localhost/glidehero-test npm run test:integration -- test/integration/schema.integration.test.ts`.

**Commit:** `feat: add grid claim configuration and storage`

### Task 2: Direct grid-cell ownership and projection

**Files:**
- Create: `src/services/gridClaimService.ts`, `test/unit/gridClaimService.test.ts`, `test/integration/gridClaimService.integration.test.ts`

**Interfaces:**

```ts
export type GridClaimProcessResult = {
  flightId: string;
  cellSize: number;
  directCellCount: number;
  enclosedCellCount: number;
};

export interface GridClaimService {
  process(input: { flightId: string; userId: string }): Promise<GridClaimProcessResult>;
  get(input: { userId: string }): Promise<GridClaimGeoJson>;
}

export function createGridClaimService(
  database: Database,
  options: { cellSize: number },
): GridClaimService;
```

`process` deletes `user_grid_claims` currently owned by the reprocessed flight, then uses one set-based transaction query. Its CTEs must be ordered as `ordered_points`, `segments`, `direct_hits`, `direct_cells`, `direct_candidates`, `combined_candidates`, `winning_candidates`, and `upserted`.

- `ordered_points` uses `LEAD` by `sequence_number` to create adjacent pairs.
- `segments` creates each WGS84 `ST_MakeLine`, transforms to EPSG:6933, and uses the lead point `recorded_at` as `segment_timestamp`.
- `direct_hits` lateral-joins `ST_SquareGrid(cellSize, ST_Envelope(segment))` and filters with `ST_Intersects`.
- `direct_cells` groups by grid `x/y`, preserving `MIN(segment_timestamp)` as `first_claimed_at` and `MAX(segment_timestamp)` as `latest_claimed_at`.
- direct candidates use the latest timestamp.
- `winning_candidates` groups candidate timestamps by `x/y` and selects `MAX`.
- Insert candidates with `ON CONFLICT (cell_size, x, y) DO UPDATE` only when the stored timestamp is strictly older; equal times retain the owner.

`get` reconstructs each cell with:

```sql
ST_Transform(
  ST_MakeEnvelope(
    x * $cellSize, y * $cellSize,
    (x + 1) * $cellSize, (y + 1) * $cellSize,
    6933
  ),
  4326
)
```

and returns Polygon Features with empty properties, or `emptyGridClaimGeoJson()` when no owned cells exist.

Integration tests must generate WGS84 track points from EPSG:6933 test coordinates, prove sparse crossing, endpoint-outside crossing, edge-following behavior, later/earlier/equal timestamp ownership, coexisting 1000m and 2000m variants, and user-scoped WGS84 Polygon GeoJSON.

**TDD cycle:** Write focused unit/integration tests; verify they fail due to the missing service; implement; run `npm test -- test/unit/gridClaimService.test.ts`, `TEST_DATABASE_URL=postgres://localhost/glidehero-test npm run test:integration -- test/integration/gridClaimService.integration.test.ts`, and `npm run typecheck`.

**Commit:** `feat: add direct grid cell claims`

### Task 3: Current-flight cell enclosures

**Files:**
- Modify: `src/services/gridClaimService.ts`, `test/unit/gridClaimService.test.ts`, `test/integration/gridClaimService.integration.test.ts`

**Interfaces:** Preserve Task 2’s public service API. `enclosedCellCount` becomes the number of candidate cells filled from holes in the current flight’s direct-cell union.

Do not node or polygonize the flight track. Extend Task 2’s SQL with these CTEs between direct and combined candidates: `flight_cell_union`, `union_polygons`, `hole_rings`, `holes`, `hole_boundaries`, `enclosed_candidates`, `candidate_events`, and `winning_candidates`.

- Union direct-cell square geometries using `ST_UnaryUnion(ST_Collect(geometry))`.
- Dump Polygon members; dump their rings; discard the exterior ring with `path[1] > 0`; convert each remaining ring to a hole Polygon using `ST_MakePolygon`.
- A boundary cell participates only when it shares a positive-length boundary segment with the hole:

```sql
ST_Length(
  ST_Intersection(ST_Boundary(direct_cells.geometry), ST_Boundary(holes.geometry))
) > 0
```

- The hole timestamp is `MAX(direct_cells.first_claimed_at)` across those boundary cells.
- Generate potential interior cells with `ST_SquareGrid(cellSize, ST_Envelope(hole.geometry))`, retaining only `ST_Covers(hole.geometry, cell.geom)`.
- Union direct and enclosed candidates, then group by coordinate and use the later timestamp before the existing ownership upsert.

Tests must establish: an open path fills nothing; an 8-cell full-edge ring fills its center; corner-only contact fills nothing; two rings both fill; an enclosed cell transfers from another user; revisiting a boundary after its first hit does not alter the enclosure timestamp; and reprocessing produces identical rows.

**TDD cycle:** Add the enclosure integration cases; run the focused integration file and see failures; add the CTEs; rerun the unit and integration service suites plus `npm run typecheck`.

**Commit:** `feat: fill grid cells enclosed by flight claims`

### Task 4: Process both modular claim variations after ingestion

**Files:**
- Modify: `src/services/flightProcessingService.ts`, `src/index.ts`
- Modify: `test/unit/flightProcessingService.test.ts`, `test/integration/igcUploadProcessing.integration.test.ts`

**Interfaces:** Change flight-processing options to:

```ts
{
  s3Client: Pick<S3, 'send'>;
  bucketName: string;
  gridClaimCellSize: number;
}
```

Construct `GridClaimService` directly with that size. After committed flight and track-point persistence, invoke both services in order:

```ts
// Claim variations — comment or uncomment individual lines to select them.
await freePolygonClaim.process({ flightId: flight.id, userId: input.ownerUserId });
await gridClaim.process({ flightId: flight.id, userId: input.ownerUserId });
```

Do not put these calls inside the persistence transaction and do not mark an already committed flight failed when either rejects.

Mock both direct service factories in the unit test. Prove both calls occur after `ingest-committed`, polygon precedes grid, and a GridClaim rejection leaves the recorded flight completion update intact. In the upload integration test use `gridClaimCellSize: 1000` and assert that the fixture creates both `flight_areas` and `user_grid_claims` rows.

**TDD cycle:** Add GridClaim factory mocks and assertions; run unit/upload tests to see missing calls; wire the service and pass `config.gridClaimCellSize` in `src/index.ts`; rerun both focused suites and typecheck.

**Commit:** `feat: process grid claims after flight ingestion`

### Task 5: Select polygon or grid GeoJSON through the territory endpoint

**Files:**
- Modify: `src/index.ts`, `src/web/webRouter.ts`
- Modify: `test/unit/webRouter.test.ts`, `test/integration/webFlow.integration.test.ts`

**Interfaces:** Router dependencies include both `freePolygonClaim: FreePolygonClaimService` and `gridClaim: GridClaimService`. The endpoint is:

```http
GET /v1/personal-territory?type=poly|grid
```

- omitted `type` and `type=poly` return `freePolygonClaim.get({ userId })`;
- `type=grid` returns `gridClaim.get({ userId })`;
- any other value returns status 400:

```json
{"error":{"code":"invalid_request","message":"Territory type must be \"poly\" or \"grid\"."}}
```

Use:

```ts
const territoryTypeSchema = z.object({
  type: z.enum(['poly', 'grid']).default('poly'),
});
```

and call `safeParse(req.query)` before selecting the service. Construct the route-facing `gridClaim` in `src/index.ts` using `config.gridClaimCellSize`. Leave `public/scripts/dashboard.js` unchanged: its no-query fetch intentionally remains polygon-default.

Update unit test doubles to return distinct MultiPolygon (poly) and Polygon (grid) FeatureCollections. Cover no parameter, explicit poly, grid, invalid type, and anonymous requests. Update the real web-flow setup to pass a GridClaim service.

**TDD cycle:** Write route selection tests; run `npm test -- test/unit/webRouter.test.ts` to see dependency/dispatch failures; implement query validation and startup injection; run focused router/dashboard/upload/web-flow tests.

**Commit:** `feat: select polygon or grid territory claims`

## Final verification

Run exactly:

```bash
npm test
TEST_DATABASE_URL=postgres://localhost/glidehero-test npm run test:integration
npm run typecheck
npm run build
```

The work is complete only when all four commands exit successfully.
