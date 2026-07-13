# FreePolygonClaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the current automatic claim-and-territory backend to FreePolygonClaim and make its IGC-ingestion call a directly commentable hardcoded line without changing the current map API.

**Architecture:** A single `FreePolygonClaimService` owns the existing PostGIS free-polygon detector and the per-user GeoJSON projection. `flightProcessingService` creates that service internally and calls it after a successful flight commit; the one call sits in a labeled variation block. The route and browser continue serving and consuming the same `/v1/personal-territory` GeoJSON contract.

**Tech Stack:** TypeScript 7, Vitest 4, Drizzle ORM 1.0 RC, PostgreSQL with PostGIS, Express 5.

## Global Constraints

- Use Drizzle ORM and Drizzle Kit 1.0-or-later APIs only.
- Keep the `flight_areas` and `personal_territories` physical tables and their stored data; do not add a migration.
- Do not change `/v1/personal-territory`, the browser map source/layer names, or the GeoJSON response shape.
- Do not introduce a claim registry, claim dependency injection into `flightProcessingService`, or a generic projection abstraction.
- Preserve the current post-commit claim failure behavior.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/domain/territory/freePolygonClaimGeoJson.ts` | FreePolygonClaim-owned GeoJSON type and empty FeatureCollection factory. |
| `src/services/freePolygonClaimService.ts` | PostGIS detection, per-user projection, read operation, and the composed processing operation. |
| `src/services/flightProcessingService.ts` | Persists IGC data and contains the commentable FreePolygonClaim variation call. |
| `src/index.ts` | Supplies a FreePolygonClaim service to the existing territory route. |
| `src/web/webRouter.ts` | Uses a FreePolygonClaim backend dependency while retaining the existing endpoint. |
| `src/db/schema.ts` | Uses the renamed GeoJSON TypeScript type without changing the database table. |

### Task 1: Move GeoJSON ownership under FreePolygonClaim

**Files:**
- Create: `src/domain/territory/freePolygonClaimGeoJson.ts`
- Delete: `src/domain/territory/personalTerritoryGeoJson.ts`
- Modify: `src/db/schema.ts:2,126`
- Create: `test/unit/freePolygonClaimGeoJson.test.ts`
- Delete: `test/unit/personalTerritoryGeoJson.test.ts`

**Interfaces:**
- Produces `FreePolygonClaimGeoJson` and `emptyFreePolygonClaimGeoJson()`, used by the service, schema, and route tests.

- [ ] **Step 1: Write the failing renamed GeoJSON test**

Create `test/unit/freePolygonClaimGeoJson.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyFreePolygonClaimGeoJson } from '../../src/domain/territory/freePolygonClaimGeoJson.js';

describe('FreePolygonClaim GeoJSON', () => {
  it('creates a new empty FeatureCollection for pilots with no claim projection', () => {
    const first = emptyFreePolygonClaimGeoJson();
    const second = emptyFreePolygonClaimGeoJson();

    expect(first).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).not.toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails because the module does not exist**

Run: `npm test -- test/unit/freePolygonClaimGeoJson.test.ts`

Expected: FAIL with an unresolved `freePolygonClaimGeoJson.js` import.

- [ ] **Step 3: Add the renamed FreePolygonClaim GeoJSON module and update the schema type import**

Create `src/domain/territory/freePolygonClaimGeoJson.ts` with the existing coordinate aliases and this public API:

```ts
export type FreePolygonClaimGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'MultiPolygon'; coordinates: GeoJsonPolygonCoordinates[] };
  }>;
};

export function emptyFreePolygonClaimGeoJson(): FreePolygonClaimGeoJson {
  return { type: 'FeatureCollection', features: [] };
}
```

Replace the schema import and `jsonb(...).$type<...>()` generic with `FreePolygonClaimGeoJson`. Remove the old domain file and test with `git rm`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm test -- test/unit/freePolygonClaimGeoJson.test.ts && npm run typecheck`

Expected: PASS, with no TypeScript errors.

- [ ] **Step 5: Commit the type rename**

```bash
git add src/domain/territory/freePolygonClaimGeoJson.ts src/domain/territory/personalTerritoryGeoJson.ts src/db/schema.ts test/unit/freePolygonClaimGeoJson.test.ts test/unit/personalTerritoryGeoJson.test.ts
git commit -m "refactor: name claim GeoJSON for FreePolygonClaim"
```

### Task 2: Consolidate detector and projection as FreePolygonClaim

**Files:**
- Create: `src/services/freePolygonClaimService.ts`
- Delete: `src/services/flightAreaDetectionService.ts`
- Delete: `src/services/personalTerritoryService.ts`
- Create: `test/unit/freePolygonClaimService.test.ts`
- Delete: `test/unit/flightAreaDetectionService.test.ts`
- Delete: `test/unit/personalTerritoryService.test.ts`
- Create: `test/integration/freePolygonClaimService.integration.test.ts`
- Delete: `test/integration/flightAreaDetectionService.integration.test.ts`
- Delete: `test/integration/personalTerritoryService.integration.test.ts`

**Interfaces:**
- Consumes `Database` and `FreePolygonClaimGeoJson` from Task 1.
- Produces `FreePolygonClaimService`:

```ts
export interface FreePolygonClaimService {
  detect(input: { flightId: string }): Promise<{ flightId: string; detectedAreaCount: number }>;
  refresh(input: { userId: string }): Promise<FreePolygonClaimGeoJson>;
  get(input: { userId: string }): Promise<FreePolygonClaimGeoJson>;
  process(input: { flightId: string; userId: string }): Promise<{ flightId: string; detectedAreaCount: number }>;
}
```

- [ ] **Step 1: Write the failing composed-process test**

Create `test/unit/freePolygonClaimService.test.ts`. Retain the existing detector transaction-double assertions and empty-projection assertions under `describe('FreePolygonClaimService')`, then add this behavior test using the service's public methods:

```ts
it('detects a flight before refreshing its pilot projection', async () => {
  const events: string[] = [];
  const database = processDatabaseDouble(events);
  const service = createFreePolygonClaimService(database as never);

  await expect(service.process({ flightId, userId })).resolves.toEqual({ flightId, detectedAreaCount: 2 });

  expect(events).toEqual(['detect-delete', 'detect-insert', 'projection-lock', 'projection-upsert']);
});
```

`processDatabaseDouble` must return a detection result of `{ detectedAreaCount: 2 }`, record the detector delete/insert events, then record the advisory-lock and projection-upsert queries. It must provide `select`, `transaction`, and transaction-local `delete`/`execute` methods used by the actual service; it should not mock a FreePolygonClaim method.

- [ ] **Step 2: Run the test to verify it fails because the service module does not exist**

Run: `npm test -- test/unit/freePolygonClaimService.test.ts`

Expected: FAIL with an unresolved `freePolygonClaimService.js` import.

- [ ] **Step 3: Implement the FreePolygonClaim service by moving the current SQL unchanged**

Create `src/services/freePolygonClaimService.ts`. Move the SQL and transaction behavior from `flightAreaDetectionService.ts` into `detect`, and move the advisory-lock, union, upsert, stale-projection deletion, and read behavior from `personalTerritoryService.ts` into `refresh` and `get`. Replace `PersonalTerritoryGeoJson` references with `FreePolygonClaimGeoJson`.

Implement composition exactly as follows:

```ts
async process({ flightId, userId }) {
  const result = await this.detect({ flightId });
  await this.refresh({ userId });
  return result;
}
```

If `this` would be fragile in the object literal, define local `detect` and `refresh` functions and call those instead. The required observable order is detector completion before projection refresh. Do not alter the PostGIS polygonization query, the 100-square-meter threshold, the advisory lock, or the stored GeoJSON shape.

Port all existing unit cases and all existing PostGIS integration cases to the new file names and `createFreePolygonClaimService`. The integration helper that persists a flight must retain the user ID where a `process({ flightId, userId })` test needs it. Keep the existing direct `detect`, `refresh`, and `get` assertions so spatial behavior and concurrent-refresh protection remain covered.

- [ ] **Step 4: Run the service unit and integration suites**

Run: `npm test -- test/unit/freePolygonClaimService.test.ts && npm run test:integration -- test/integration/freePolygonClaimService.integration.test.ts`

Expected: all renamed behavior tests pass, including the composed operation ordering test and PostGIS spatial cases.

- [ ] **Step 5: Commit the FreePolygonClaim vertical slice**

```bash
git add src/services/freePolygonClaimService.ts src/services/flightAreaDetectionService.ts src/services/personalTerritoryService.ts test/unit/freePolygonClaimService.test.ts test/unit/flightAreaDetectionService.test.ts test/unit/personalTerritoryService.test.ts test/integration/freePolygonClaimService.integration.test.ts test/integration/flightAreaDetectionService.integration.test.ts test/integration/personalTerritoryService.integration.test.ts
git commit -m "refactor: consolidate FreePolygonClaim backend"
```

### Task 3: Make FreePolygonClaim a commentable ingestion variation

**Files:**
- Modify: `src/services/flightProcessingService.ts:1-105`
- Modify: `test/unit/flightProcessingService.test.ts:1-220`
- Modify: `test/integration/igcUploadProcessing.integration.test.ts:1-110`

**Interfaces:**
- Consumes `createFreePolygonClaimService(database)` from Task 2.
- Produces a `createFlightProcessingService(database, { s3Client, bucketName })` API with no claim-service options.

- [ ] **Step 1: Write the failing hardcoded-variation unit test**

At the top of `test/unit/flightProcessingService.test.ts`, hoist a FreePolygonClaim double and mock the direct module import:

```ts
const freePolygonClaim = vi.hoisted(() => ({ process: vi.fn() }));

vi.mock('../../src/services/freePolygonClaimService.js', () => ({
  createFreePolygonClaimService: vi.fn(() => freePolygonClaim),
}));
```

In the successful-processing test, set `freePolygonClaim.process.mockImplementation(async () => { events.push('free-polygon-claim-processed'); return { flightId, detectedAreaCount: 0 }; })`, construct the processor without `areaDetection` or `personalTerritory` options, and assert:

```ts
expect(freePolygonClaim.process).toHaveBeenCalledWith({ flightId, userId: ownerUserId });
expect(events).toEqual(['ingest-started', 'ingest-committed', 'free-polygon-claim-processed']);
```

Replace the old detector/projection failure case with one that makes `freePolygonClaim.process` reject. Assert that the transaction committed and the flight remains `completed`, preserving the post-commit retry boundary.

- [ ] **Step 2: Run the test to verify it fails against the old injected dependency API**

Run: `npm test -- test/unit/flightProcessingService.test.ts`

Expected: FAIL because `flightProcessingService` does not import or invoke FreePolygonClaim directly.

- [ ] **Step 3: Remove claim dependencies and add the hardcoded variation block**

In `src/services/flightProcessingService.ts`:

1. Replace the two old type imports with `createFreePolygonClaimService`.
2. Remove `areaDetection` and `personalTerritory` from the options type; leave only `s3Client` and `bucketName`.
3. Immediately inside `createFlightProcessingService`, create `const freePolygonClaim = createFreePolygonClaimService(database);`.
4. Replace the two old calls after the persistence transaction with exactly this labeled block:

```ts
// Claim variations — comment or uncomment individual lines to select them.
await freePolygonClaim.process({ flightId: flight.id, userId: input.ownerUserId });
```

This line is the sole enable/disable switch for the variation. Do not create a registry, conditional configuration, or constructor option for it.

Update the upload integration setup to construct the processor with only its S3 options and use `createFreePolygonClaimService(database.db).get(...)` for the unchanged projected-territory assertion.

- [ ] **Step 4: Run focused ingestion tests**

Run: `npm test -- test/unit/flightProcessingService.test.ts && npm run test:integration -- test/integration/igcUploadProcessing.integration.test.ts`

Expected: unit ordering and error-boundary tests pass; the real IGC fixture still creates `flight_areas` and returns the same MultiPolygon projection.

- [ ] **Step 5: Commit the hardcoded ingestion variation**

```bash
git add src/services/flightProcessingService.ts test/unit/flightProcessingService.test.ts test/integration/igcUploadProcessing.integration.test.ts
git commit -m "refactor: hardcode FreePolygonClaim ingestion variation"
```

### Task 4: Rewire the backend route while preserving the map contract

**Files:**
- Modify: `src/index.ts:1-50`
- Modify: `src/web/webRouter.ts:1-60`
- Modify: `test/unit/webRouter.test.ts:1-420`
- Modify: `test/integration/webFlow.integration.test.ts:1-70`

**Interfaces:**
- Consumes `FreePolygonClaimService.get({ userId })` from Task 2.
- Preserves `GET /v1/personal-territory` and its exact `FreePolygonClaimGeoJson` response.

- [ ] **Step 1: Change route test fixtures to use the new backend type while retaining the endpoint assertions**

Replace the old GeoJSON/service imports in `test/unit/webRouter.test.ts` with `FreePolygonClaimGeoJson`, `emptyFreePolygonClaimGeoJson`, and `FreePolygonClaimService`. Rename fixture variables and dependency keys from `personalTerritory` to `freePolygonClaim`. Keep these assertions unchanged:

```ts
expect(response.status).toBe(200);
expect(await response.json()).toEqual(expectedGeoJson);
expect(freePolygonClaim.get).toHaveBeenCalledWith({ userId: user.userId });
```

Update `test/integration/webFlow.integration.test.ts` to create and supply `createFreePolygonClaimService(testDatabase.db)` under the new dependency name. Its existing browser-auth flow assertions remain unchanged.

- [ ] **Step 2: Run the route test to verify it fails against the old backend dependency name**

Run: `npm test -- test/unit/webRouter.test.ts`

Expected: FAIL because `createWebRouter` still expects `personalTerritory` and imports the old service type.

- [ ] **Step 3: Rename backend wiring without changing the public endpoint**

In `src/web/webRouter.ts`, import `FreePolygonClaimService`, rename the dependency property to `freePolygonClaim`, and call `dependencies.freePolygonClaim.get(...)` inside the existing `/v1/personal-territory` handler. Do not rename the route, authentication message, or browser-facing text.

In `src/index.ts`, construct `const freePolygonClaim = createFreePolygonClaimService(db)`, remove construction of the old detector and personal-projection services, pass only S3 configuration to `createFlightProcessingService`, and pass `freePolygonClaim` to `createWebRouter`.

- [ ] **Step 4: Run the full verification suite**

Run: `npm test && npm run test:integration && npm run typecheck && npm run build`

Expected: all unit tests, integration tests, TypeScript checking, and production compilation pass. The browser map tests must still request `/v1/personal-territory` and assert the existing source and layer IDs.

- [ ] **Step 5: Commit the preserved map-contract wiring**

```bash
git add src/index.ts src/web/webRouter.ts test/unit/webRouter.test.ts test/integration/webFlow.integration.test.ts
git commit -m "refactor: wire territory route to FreePolygonClaim"
```

## Plan self-review

- Spec coverage: Tasks 1-2 rename and encapsulate the existing backend claim system; Task 3 provides the single hardcoded commentable ingestion line; Task 4 preserves the endpoint and browser map contract. No generic projection, registry, or database migration is included.
- Placeholder scan: no deferred implementation items or ambiguous behavior remain.
- Type consistency: `FreePolygonClaimGeoJson` is defined in Task 1 and consumed by Task 2; `FreePolygonClaimService` is defined in Task 2 and consumed by Tasks 3-4; the processor's two remaining options are S3-specific.
