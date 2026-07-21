# GlideHero Architecture

This guide describes the architecture used in this repository and helps coding agents decide where new files and behavior belong. Prefer extending these established layers over introducing new architectural abstractions.

## Architecture at a glance

GlideHero is a server-rendered Express application with browser-side JavaScript
for interactive maps, uploads, and forms. PostgreSQL with PostGIS is the system
of record, Drizzle provides database access, and Vento renders HTML. Private
S3-compatible object storage holds uploaded IGC files, while Valkey holds the
transient upload state and Streams work queue consumed by flight workers.

The usual request flow is:

```text
Browser
  -> Express app and middleware
  -> Router
  -> Service
  -> Domain logic and/or database query
  -> PostgreSQL, PostGIS, Valkey, object storage, or another external resource
  -> HTML, JSON, GeoJSON, or Mapbox Vector Tile response
```

Dependencies should generally point inward:

- Delivery code calls services.
- Services call domain logic and infrastructure.
- Domain code does not know about Express, Vento, Drizzle, or browser APIs.

## 1. Process startup and composition

Locations:

- `src/index.ts` for the HTTP process.
- `src/worker.ts` for the flight-worker process.
- `src/services/flightWorkerRuntime.ts` for worker lifecycle and shutdown.

`src/index.ts` is the web composition root and executable entry point. It:

- Reads and validates configuration.
- Creates the database and external clients.
- Constructs services, middleware, routers, cookies, and renderers.
- Passes dependencies explicitly into factory functions.
- Starts the HTTP server.

`src/worker.ts` independently creates the database, object-storage, and Valkey
clients needed to consume flight jobs. It gives blocking Stream reads their own
Valkey connection and delegates concurrent processing, maintenance loops, and
graceful shutdown to `flightWorkerRuntime.ts`.

Put code in these entry points only when it is required to assemble or start a
running process.

Do not put business rules, request handling, database queries, or reusable helpers here. When adding a service or router, create it in its appropriate layer and wire it together here.

## 2. Application shell

Location: `src/app.ts`

The application shell configures behavior shared by the entire Express application:

- Body parsing.
- Request logging.
- Static-file serving.
- Mounting injected middleware and routers.
- API-versus-HTML not-found behavior.
- Centralized error handling and error-page rendering.

Put application-wide HTTP policy here. Feature endpoints belong in routers, while feature behavior belongs in services.

`createApp` accepts its web dependencies so it can be tested without starting a real server.

It does not participate in the background worker process.

## 3. Configuration

Locations:

- `src/config.ts`
- `.env.example`
- Environment-specific deployment files

Configuration owns:

- Environment-variable parsing.
- Validation and defaults.
- Normalization.
- The typed `AppConfig` used by the composition root.

When adding configuration:

1. Add and validate the environment variable in `src/config.ts`.
2. Expose a normalized application-facing property on `AppConfig`.
3. Document it in `.env.example` when developers must provide it.
4. Pass the value from `src/index.ts` into the code that needs it.

Services and routers should receive configuration as arguments rather than reading `process.env` directly.

## 4. HTTP delivery layer

### Web routers

Location: `src/web/`

Routers are the boundary between HTTP and the application. They own:

- Route paths and HTTP methods.
- Route-specific authentication and authorization.
- Parsing and validating paths, queries, forms, files, and JSON bodies.
- Translating validated input into service calls.
- Selecting status codes, redirects, response types, and page models.
- Forwarding unexpected errors to the application error handler.

Use Zod or a focused boundary parser here for untrusted HTTP input.

Do not embed reusable business rules or substantial SQL in routers. If behavior would still matter when invoked outside HTTP, it belongs in a service or the domain.

`src/web/webRouter.ts` owns the main user-facing pages and APIs. A cohesive feature with distinct access rules or a large route surface may have its own router, as the admin-area feature does in `src/web/adminAreaRouter.ts`.

### HTTP middleware and cookies

Locations:

- `src/web/` for web-specific middleware and session-cookie behavior.
- `src/middleware/` for application-wide Express middleware.

Put request-lifecycle concerns here, including:

- Resolving the current user.
- Reading and writing session cookies.
- Request logging.
- Other cross-cutting HTTP behavior.

Middleware may enrich `res.locals` or enforce HTTP policy, but it should delegate application behavior to services.

### Small standalone routes

Location: `src/routes/`

This directory currently contains the standalone health router.

Keep small operational routes here when they do not need the full web feature dependency graph. User-facing feature routes should normally follow the `src/web/` factory-and-dependency pattern.

## 5. Service layer

Location: `src/services/`

Services implement application use cases and coordinate work across domain logic, persistence, and external resources.

Services own:

- Use-case workflows such as authentication, file processing, territory claiming, profile updates, arena queries, and admin operations.
- Transaction boundaries.
- Multi-step persistence.
- Feature-specific Drizzle queries and PostGIS SQL.
- Coordination of domain functions and external clients.
- Application-facing interfaces and result types.

This repository does not currently have a separate repository or data-access layer. Feature-specific database access therefore belongs in the relevant service.

If several services genuinely need a shared query, extract it into a focused service or helper. Do not combine persistence rules belonging to different use cases merely because their SQL is similar.

Services should not depend on:

- Express requests or responses.
- Vento templates.
- DOM or browser APIs.

Prefer factories such as:

`createFeatureService(database, options)`

Pass external dependencies explicitly. This keeps services testable and makes ownership visible in `src/index.ts`.

When a feature spans several layers, implement it as a thin vertical slice:

1. Add the endpoint or entry point.
2. Add the minimal service method.
3. Add the minimal query or external operation.
4. Return a real result through the endpoint.
5. Add tests for the completed path.
6. Add additional behavior one observable slice at a time.

## 6. Domain layer

Location: `src/domain/`

Domain modules contain framework-independent business concepts, rules, calculations, normalization, parsing, and transformations.

Existing examples include:

- IGC parsing and flight calculations.
- Competition-month normalization.
- Launch-time-zone rules.
- Arena route identifiers.
- Grid GeoJSON construction.
- Leaderboard and viewport-stat transformations.
- Domain error types.

Put logic here when it can be expressed without HTTP, database, filesystem, template, or browser concerns.

Domain functions should generally:

- Accept plain values.
- Return plain values.
- Be deterministic where practical.
- Throw focused domain errors when necessary.
- Avoid infrastructure dependencies.

Organize related concepts in a feature directory such as:

- `src/domain/igc/`
- `src/domain/competition/`
- `src/domain/territory/`

Do not move a database query into the domain merely because it contains a business rule. Keep the query in a service and extract only the pure rule or transformation.

## 7. Persistence foundation

Locations:

- `src/db/`
- `drizzle.config.ts`

The persistence foundation owns database-wide definitions and connection setup.

### `src/db/schema.ts`

Defines:

- PostgreSQL tables and columns.
- Constraints and foreign keys.
- Indexes.
- Enums and sequences.
- PostGIS custom types.

### `src/db/relations.ts`

Defines Drizzle relations between schema entities.

### `src/db/client.ts`

Creates the PostgreSQL connection pool and typed Drizzle client.

### `src/db/types.ts`

Contains shared database-derived types.

### `drizzle.config.ts`

Configures Drizzle Kit, including PostGIS handling.

Put structural database definitions in this layer. Put feature queries and transactional workflows in services.

Schema changes should preserve database invariants using constraints and indexes where appropriate. Verify schema changes with `npm run db:migrate` against the worktree database.

This project uses Drizzle ORM and Drizzle Kit 1.0 release candidates. Use documentation and APIs for version 1.0 or later.

Migrations use Drizzle's current folder format: each ordered directory under
`drizzle/` contains a `migration.sql` and matching `snapshot.json`. Keep the
directory order contiguous when adding schema changes; verify a disposable
database with `npm run db:migrate` before deployment. The older V2
`drizzle/meta/_journal.json` format is not used by this repository.

PostgreSQL has the PostGIS extension installed. Keep geometry types and operations consistent with the existing schema and Drizzle configuration.

### Arena geometry and scoring

`arenas.area` is the sole Arena-membership source of truth. It is a required,
valid `geometry(MultiPolygon,6933)`. All Arenas use the same polygon authoring
experience and the same search, canonical routes, boundaries, leaderboards,
territory, and monthly/all-time behavior.

The canonical `arenas` table classifies rows as `launch`, `general`, `state`, or
`country`. Every row has an uppercase ISO-3166-1 alpha-2 `country_code`.
`claimable_cell_count` and `claimable_cell_size` are populated only for Launch
and General rows. The checked-in Natural Earth country artifact is reduced by
the documented Release 2 policy to 194 Country Arenas; the Census source
imports exactly 50 State Arenas; the launch source generates a configured 5x5
grid for each Launch Arena. `npm run rebuild:arenas` performs the one-time,
transactional rebuild. Its default is a dry-run; applying requires
`--apply --confirm-delete-all-arenas` and deletes all existing rows, including
General Arenas. It does not preserve rows, track changes, or promise a safe
rerun.

Competition claims remain global and Arena-independent. For Arena reads,
`MonthlyCoverageService` constructs each claim-cell center as
`((x + 0.5) * cell_size, (y + 0.5) * cell_size)` in EPSG:6933 and uses
`ST_Covers(arena.area, center)`. Boundary centers therefore count. Adding or
editing an Arena immediately changes the view over historical claims without
flight reprocessing.

Personal, Global competition, and Arena territory are served as authenticated,
on-demand Mapbox Vector Tiles by `TerritoryTileService`. Each query derives its
grid range from the requested tile envelope before constructing cell geometry.
Personal cells are dissolved into connected regions within the tile query;
competition tiles contain per-cell claimant metadata. Arena tiles apply the
canonical Arena center-coverage rule in addition to the tile range.

Tile zoom ranges are centralized in `src/config/territoryTiles.ts` and supplied
to both the HTTP coordinate validation and the rendered MapLibre source
configuration. The admin map-settings page can change these ranges only in the
current web process; they are not persisted to PostgreSQL.

The Arena editor accepts drawn or imported WGS84 Polygon/MultiPolygon inputs,
applies two-dimensional make-valid,
transformation, collection, union, and MultiPolygon normalization. Disconnected
components and islands remain; overlaps and edge-adjacent components merge;
imported holes may remain.

Public Arena grids and Arena draft previews are generated only for the
visible viewport using `viewportCtes`, the configured result limit, and the same
center-point `ST_Covers` rule. The draft preview is admin-only and evaluates the
unsaved geometry. The state importer uses the same save normalization, imports
the 50 states by stable Census FIPS identity once, rejects existing State
Arenas, and excludes D.C. and territories.

The admin editor creates General Arenas by default and requires selecting an
existing Country Arena from the imported catalog. Editing an imported row
preserves its source identity and metadata; only applicable Launch/General
claimable denominators are recomputed with configured-grid cell centers and
`ST_Covers`. State and Country progress is intentionally a boolean Flown-in
state rather than a denominator.

On an Arena page, competition remains the existing additive leaderboard and
period view. The same Arena search is also available from Personal. The
Personal card beside the leaderboard reports Launch visited plus `x/y` cells,
General `x/y`, percentage, and next 10/25/50/75/100 milestone, or only Flown in
for State/Country. Progress dates are kept internal to services and are not
rendered.

## 8. External resources and adapters

Location: `src/resources/`

Resource modules construct clients for systems outside the application:

- `bucketClient.ts` configures the S3-compatible private object store.
- `valkeyClient.ts` validates `redis://`/`rediss://` connection URLs and creates
  GLIDE clients.

They translate typed application configuration into configured SDK clients.

Put low-level client construction and adapter setup here. Put the workflow that uses the client in a service, and inject the client from `src/index.ts`.

This prevents external SDK setup from leaking into domain or route code and allows services to receive test doubles.

## 9. Server-rendered presentation

Location: `src/views/`

### Renderers

Location: `src/views/renderer.ts`

Renderers:

- Create the Vento environment.
- Define typed page models.
- Select page templates.
- Supply shared template defaults.

Routers call renderers. Renderers do not perform business workflows or database access.

Add a renderer or model when a page family needs a distinct rendering contract. Keep template selection and defaults here instead of scattering direct Vento calls through routers.

### Layouts

Location: `src/views/layouts/`

Layouts define reusable page shells:

- Document structure.
- Shared assets.
- Broad page framing.

Add or change a layout when multiple pages share the same outer structure.

### Pages

Location: `src/views/pages/`

Pages are route-level Vento templates. They assemble layouts and components for one screen or page mode.

A page should describe composition. It should not contain backend queries or large reusable UI fragments.

### Components

Location: `src/views/components/`

Components are reusable server-rendered UI fragments such as:

- Navigation.
- Forms.
- Cards.
- Search controls.
- Breadcrumbs.
- Onboarding UI.

Before creating a component, reuse an existing component if it already owns the feature or can support the change without major refactoring.

Move repeated or independently meaningful markup out of pages and into a focused component.

## 10. Browser presentation and interaction

Location: `public/`

Everything in `public/` is served directly to the browser.

### Browser scripts

Location: `public/scripts/`

Browser modules own:

- DOM behavior.
- Browser-side state.
- Fetch calls.
- Map integration.
- Progressive enhancement.
- Client-side presentation transformations.

Browser modules should use data attributes and markup contracts rendered by Vento templates.

Keep server-side authorization and business rules on the server. Browser validation improves usability but is not a security or data-integrity boundary.

Extract reusable browser behavior into a focused module instead of continually growing a page entry script.

Feature-specific browser assets may use a subdirectory, as the admin area editor does.

### On-demand territory tiles

`personalMap.js` and `competitionCoverageMap.js` install MapLibre vector
sources for Personal and competition territory. MapLibre requests the visible
tiles from the authenticated `.mvt` endpoints as the map moves. Territory is
hidden below the configured minimum zoom, and HTTP routes reject coordinates
outside each configured zoom range.

Changing the competition period or selected pilot replaces the competition
tile URL so MapLibre reloads the correct scope. Arena tile URLs include the
Arena source ID and apply the same polygon membership rule used by its complete
leaderboard. Personal stats and the Global leaderboard remain viewport-based
JSON requests and refresh independently of territory tiles.

### Asynchronous flight uploads

`flightUploads.js` owns the browser upload lifecycle. It accepts individual IGC
files or uses `zipIgcFiles.js` to validate and extract IGC entries from ZIP
archives, creates an authenticated upload intent, sends each file directly to
object storage with a presigned `PUT`, and calls the completion endpoint. The
browser limits upload concurrency and polls Valkey-backed progress while the
status dialog is open.

`FlightUploadQueueService` owns upload admission, job state and indexes, the
`glidehero:flight-jobs` Stream, presigning, and abandoned-upload cleanup. Job
states progress through `uploading`, `queued`, `processing`, and a terminal
`completed`, `duplicate`, or `failed` state. PostgreSQL remains untouched until
a worker claims a queued upload.

`FlightWorkerService` consumes the `flight-workers` group, downloads each
object, hashes it for duplicate detection, persists IGC metadata, delegates
parsing and claim creation to `FlightProcessingService`, and reconciles the
terminal database and queue state. It also recovers stale claims and performs
leased cleanup so multiple worker processes can operate safely. Blocking
`XREADGROUP` calls use a dedicated Valkey client; maintenance and acknowledgments
use the normal client.

### Map flight aids

The reusable flight-aid modules in `public/scripts/` are composed by
`mapFlightAids.js` and initialized by the Global/Arena competition controller
and the Personal dashboard. They keep three concerns separate:

- `mapGridOverlay.js` fetches and renders neutral grid outlines. Viewport maps
  use `/v1/grid`; Arena maps use the viewport-bounded `/v1/arenas/:sourceId/grid`.
- `mapLocationTracker.js` owns the foreground geolocation watch, follow/pan
  state, accuracy filtering, and trail segmentation.
- `mapTrailStore.js` owns the single browser-local trail. `mapTrailLayer.js`
  renders its segments and current-position dot.

The shared `mapButtonControl.js` keeps the custom MapLibre controls accessible
and visually consistent. `mapFlightAidStatus.vto` is the reusable page contract
for transient status and error messages.

Grid geometry remains server-owned. `MapGridService` in `src/services/` uses
PostGIS to generate viewport grid cells. Arena grid requests retain cells whose
centers are covered by the canonical Arena polygon, while
`mapGridGeoJson.ts` in `src/domain/territory/` builds the response shape. The
browser controls only presentation and request timing; API routes remain
authenticated and enforce viewport validation and result limits.

Live location and its trail deliberately remain browser-only state. They are
not sent to the server, do not enter the flight-upload pipeline, and do not
affect territory or competition calculations. Browser background execution is
not part of this architecture; visibility changes break the trail into separate
segments before foreground tracking resumes.

### Styles

Location: `public/styles/`

Stylesheets own shared and feature-specific presentation. Reuse existing styles and established responsive behavior before adding new styling systems.

### Static assets

Locations:

- Directly under `public/`.
- An appropriate asset subdirectory when grouping is useful.

Static images, favicons, and browser-delivered files belong here.

When changing an interactive component, inspect its Vento markup, browser module, styles, and tests together. These files form one UI contract.

## 11. Scripts and operational workflows

Location: `src/scripts/`

Scripts are executable operational or data-management entry points, such as importing launch metadata or the Census state Arenas.

Scripts may compose existing services and domain functions, but reusable behavior should live in those layers rather than only in the script.

Add a corresponding `package.json` command when a script is intended to be run by developers or deployment tooling.

Scripts should validate required inputs and make destructive or one-off behavior explicit.

Release 2 achievement definitions are exhaustive in
`src/domain/achievement/catalog.ts`. Ordinary awards are permanent and
idempotent. The launch-tag personal-best value is written to
`achievement_records` together with immutable `achievement_record_events` in
one transaction; a new record is awarded only for a strict positive increase.
The live evaluator runs after a claim rebuild while holding the per-user
advisory transaction lock. It counts distinct configured-grid cells using
EPSG:6933 center `ST_Covers`, ignores invalid denominators for coverage awards,
and never revokes an existing award. Profile reads merge ordinary awards and
record events into one latest-50 activity list without exposing raw keys or
details.

`npm run backfill:arena-achievements` is a one-time historical as-of replay.
It defaults to dry-run, supports explicit `--apply`, preserves earliest source
attribution, and reconstructs strict launch-tag records. Dry-run uses one
rollback-only transaction per user. Apply uses bounded flight batches (100 by
default, configurable with `ARENA_ACHIEVEMENT_BACKFILL_BATCH_SIZE`) and reacquires
the per-user progression lock for every batch transaction. A backfill-specific
replay loads cell-to-Arena and origin-to-Launch membership once per user and
maintains cumulative Arena state in memory; the live evaluator remains unchanged.
A typed failure says
whether earlier batches may remain committed. Workers must be paused and drained
for the catalog rebuild and backfill, then restarted only after verification.

## 12. Shared type declarations

Location: `src/types/`

Use this directory for ambient declarations or compatibility typing that applies across the application, such as declarations for untyped dependencies.

Feature-owned interfaces and result types should stay near the service, domain module, renderer, or adapter that owns them.

Avoid creating a general type bucket for types that have a clear feature owner.

## 13. Tests

Locations:

- `test/unit/`
- `test/integration/`
- `test/support/`
- `test/inputs/`

### Unit tests

Location: `test/unit/`

Unit tests cover:

- Pure domain rules.
- Services with controlled dependencies.
- Router contracts.
- Renderers.
- Browser modules.
- CSS and markup contracts.

These tests should not require the full production stack unless the behavior being tested genuinely depends on it.

### Integration tests

Location: `test/integration/`

Integration tests cover:

- Real database behavior.
- Transactions.
- Constraints and indexes.
- PostGIS queries and geometry.
- Complete persistence paths.
- HTTP flows involving real application components.

### Test support and fixtures

- `test/support/` contains reusable test infrastructure rather than product code.
- `test/inputs/` contains stable input fixtures such as sample IGC files.

Tests should mirror the layer or feature being changed. Pure rules need focused unit tests. SQL, constraints, transactions, and geometry persistence need integration coverage.

A vertical feature should normally protect both its public boundary contract and its important persistence behavior.

## File-placement decision guide

| New behavior or artifact | Put it here |
| --- | --- |
| Pure calculation, normalization, parsing, or business rule | `src/domain/<feature>/` |
| Application use case or feature workflow | `src/services/<feature>Service.ts` |
| Feature-specific Drizzle or PostGIS query | Owning service in `src/services/` |
| Table, constraint, index, relation, or database-wide type | `src/db/` |
| HTTP route, input validation, redirect, or response mapping | `src/web/` |
| Application-wide Express middleware | `src/middleware/` |
| Session or current-user HTTP concern | `src/web/` |
| External SDK client construction | `src/resources/` |
| Web dependency wiring or HTTP startup | `src/index.ts` |
| Flight-worker wiring and startup | `src/worker.ts` and `src/services/flightWorkerRuntime.ts` |
| Application-wide Express, error, or static-file policy | `src/app.ts` |
| Route-level server-rendered screen | `src/views/pages/` |
| Reusable server-rendered UI | `src/views/components/` |
| Shared HTML shell | `src/views/layouts/` |
| Page model, renderer, or template defaults | `src/views/renderer.ts` |
| DOM behavior, fetch calls, or map interaction | `public/scripts/` |
| Styling | `public/styles/` |
| Static image or browser asset | `public/` |
| Operational import or generation command | `src/scripts/` and `package.json` |
| Ambient third-party type declaration | `src/types/` |
| Pure or isolated behavior test | `test/unit/` |
| Real database, PostGIS, transaction, or full-flow test | `test/integration/` |

## Boundaries to preserve

- Routers translate HTTP; services execute use cases.
- Services own feature persistence; domain modules remain infrastructure-independent.
- Renderers and templates present data; they do not fetch it.
- Browser code enhances the UI; it is not an authorization or data-integrity boundary.
- `src/index.ts` and `src/worker.ts` wire process dependencies; constructors and factories should not hide global environment reads.
- Shared code should have a real second consumer or a clear domain identity.
- Avoid placeholder repositories, generic utility buckets, and abstractions created only to make the folder tree look layered.
- Preserve existing public route, JSON, GeoJSON, template, and data-attribute contracts unless the task explicitly changes them.
- Prefer small, feature-focused vertical slices over implementing an entire layer in isolation.
