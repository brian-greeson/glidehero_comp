# GlideHero Architecture

This guide describes the architecture used in this repository and helps coding agents decide where new files and behavior belong. Prefer extending these established layers over introducing new architectural abstractions.

## Architecture at a glance

GlideHero is a server-rendered Express application with browser-side JavaScript
for interactive maps, uploads, and forms. PostgreSQL with PostGIS is the system
of record, Drizzle provides database access, and Vento renders HTML. Private
S3-compatible object storage holds uploaded IGC files and generated flight
territory thumbnails, while Valkey holds the transient upload state and Streams
work queue consumed by flight workers.

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

`src/worker.ts` independently creates the database, object-storage, thumbnail,
and Valkey services needed to consume flight jobs. It gives blocking Stream
reads their own Valkey connection and delegates concurrent processing,
maintenance loops, and graceful shutdown to `flightWorkerRuntime.ts`.

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

The authenticated Activity surface is also owned by `webRouter.ts`:

- `GET /activity` renders the Activity page, including literal,
  case-insensitive display-name search (excluding the viewer and limiting the
  result to 10 pilots).
- `GET /activity/feed` returns the next server-rendered feed fragment for the
  opaque publication-timestamp/ID cursor; the page also exposes a normal
  `GET /activity?before=...` link for the no-JavaScript path.
- `POST /pilots/:userId/follow` and `/unfollow` are idempotent mutations that
  redirect to a validated local destination. A valid UUID for a nonexistent
  pilot is handled as a controlled 404 rather than a database error.
- `POST /activities/:activityId/thermal` toggles one Thermal for the current
  pilot and returns the normal redirect or progressive-enhancement response.

Pilot display names in competition leaderboards link to `/pilots/:userId`; the
profile page exposes the same Follow/Unfollow control used by Activity search.

Self-following has no persisted row or control. Feed visibility always includes
the viewer's own activities and actors currently followed, so following reveals
earlier Release 4 activity and unfollowing hides it on the next read. The
surface intentionally exposes no follower/following counts or lists.

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

`followService.ts` owns idempotent follow/unfollow state and bounded pilot
search. `activityService.ts` owns flight publication, current-follow feed
visibility, stable keyset pagination, joined flight summaries, grouped
accomplishments, and Thermal toggling. Feed reads batch-load accomplishment
sources for the visible page and calculate Thermal counts/viewer state in the
same query rather than issuing one query per card.

Flight cards link the pilot to their profile and derive launch-time-zone date,
duration, distance, direct-plus-enclosed total cells, and Launch Arena name/link
or four-decimal coordinates. Their grouped accomplishments include one-time
achievement awards, completed milestones, new personal-record events, and only
positive `took`/`reclaimed` leadership events when entering or re-entering first
place; unawarded progress, `lost`, and lower-rank changes are excluded. The
owner sees Thermal counts but cannot send a Thermal to their own card. Thermal
actions are intentionally not gated by current feed visibility, and reactor
lists are not exposed. Comments, messaging, reposts, manual posts, photo or
video uploads, groups, general-purpose notifications, and feed preferences are
not part of this feature.

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

Release 4 persistence adds three tables. `pilot_follows` has a composite key of
follower and followed user IDs, cascading user foreign keys, and a check that
prevents self-follow rows. `activities` stores an actor, generic `activity_type`,
nullable unique `source_flight_id`, immutable `published_at`, and timestamps;
flight activities require a source flight and the source-flight foreign key
cascades deletion. `activity_reactions` stores one `(activity_id,
reactor_user_id)` row, carries the activity owner for a composite foreign-key
check, cascades activity/user deletion, and rejects self-reactions. These
constraints enforce the idempotency and self-action rules even when a service
is bypassed.

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
`claimable_cell_count` is meaningful and maintained only for General and Launch
rows. Any legacy value on a State or Country row is ignored and is not
recalculated. State and Country ownership is exclusive by the claim-cell center,
while General Arenas may overlap and retain their own coverage counts. Among
same-type State or Country Arenas that cover a center, the row with the
lexically lowest non-empty `external_id` under the `C` collation owns the cell.
State and Country ownership are evaluated independently, so the same cell may
belong to one State and one Country as well as any covering General Arenas. The
database requires a non-empty, type-unique `external_id` for State and Country
rows. The application grid size is fixed at 500 meters in `AppConfig` and is not
persisted on claim rows.
The checked-in Natural Earth country artifact is reduced by
the documented Release 2 policy to 194 Country Arenas; the Census source
imports exactly 50 State Arenas; the launch source generates a fixed 5x5
grid for each Launch Arena. `npm run rebuild:arenas` performs the one-time,
transactional rebuild. Its default is a dry-run; applying requires
`--apply --confirm-delete-all-arenas` and deletes all existing rows, including
General Arenas. It does not preserve rows, track changes, or promise a safe
rerun.

Competition claims remain global and Arena-independent. For Arena reads,
`MonthlyCoverageService` constructs each claim-cell center as
`((x + 0.5) * 500, (y + 0.5) * 500)` in EPSG:6933. General and Launch
membership uses `ST_Covers(arena.area, center)` directly. State and Country
membership also excludes a cell when a lexically lower same-type `external_id`
covers its center. Boundary centers therefore count, but overlapping State or
Country cells have only one same-type owner. Adding or editing an Arena
immediately changes the view over historical claims without flight
reprocessing. Editing a State or Country Arena reconciles leadership for the
edited row and same-type peers intersecting either its old or new geometry.

Release 3 leadership is a durable projection of each eligible Arena's all-time
Competition claims, not a separate scoring system. `arena_leadership_states`
stores the leading and next-rank cell counts and reconciliation cursor;
`arena_current_leaders` stores every pilot tied at the highest positive count,
including the claim that most recently put that pilot into the lead;
`arena_leadership_events` stores internal `took`, `reclaimed`, and `lost`
transitions. Launch Arenas are ineligible, and no Global state exists because
Global scoring depends on the current viewport.

After a flight adds cells, `ArenaClaimImpact` finds only eligible Arenas that
canonically own an affected cell. Chronological additions use an incremental
leadership update; flight reprocessing, flight deletion, geometry changes, and
historical corrections use full reconciliation for affected Arenas. Advisory
transaction locks serialize leadership writes per Arena. Stable event keys and the
one-row-per-user achievement constraint make retries idempotent. Took-the-Lead
and Reclaimed-the-Lead achievements use the decisive cell-claim timestamp and
source flight, are each earned only once, and remain after leadership is lost.
The transition history remains internal storage; Release 4 Activity cards read
only positive `took` and `reclaimed` events associated with the completed flight
and omit `lost` or lower-rank changes. Profiles still expose only the live
Current Arena Leaderships projection and ordinary achievement entries.

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
claimable denominators are recomputed with fixed 500-meter application-grid
cell centers and `ST_Covers`. State and Country progress is intentionally a boolean Flown-in
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

Views are organized by audience and access boundary:

```text
src/views/
├── renderer.ts                 # landing and error renderer
├── pages/                      # landing and error pages
├── components/                 # unauthenticated landing components
├── layouts/                    # root landing/error shell; shared by some admin pages
├── authenticated/
│   ├── renderer.ts
│   ├── models.ts
│   ├── adapters/
│   ├── pages/
│   ├── components/
│   └── layouts/
└── admin/
    ├── renderer.ts
    ├── pages/
    ├── components/
    └── layouts/
```

Put a view in the narrowest matching family:

- Public landing and error presentation stays directly under `src/views/`.
- Signed-in pilot presentation belongs under `src/views/authenticated/`.
- Administrator-only presentation belongs under `src/views/admin/`.
- Do not place authenticated or admin templates in the root `pages/`, `components/`, or `layouts/` directories merely because another view includes them.
- Keep a genuinely shared layout at the root only when multiple view families intentionally use the same shell. Do not move a feature-specific component to the root to avoid a qualified include path.

Authenticated presentation adapters convert service results into typed, display-ready models and belong in `src/views/authenticated/adapters/`. Authenticated model types, preview fixtures, and presentation-only helpers belong alongside that family in `src/views/authenticated/`. They should not contain database access or application workflows.

### Renderers

Locations:

- `src/views/renderer.ts` for landing and error pages.
- `src/views/authenticated/renderer.ts` for authenticated pages and fragments.
- `src/views/admin/renderer.ts` for admin pages.

Renderers:

- Create the Vento environment.
- Define typed page models.
- Select page templates.
- Supply shared template defaults.

Routers call renderers. Renderers do not perform business workflows or database access.

Add a renderer or model when a page family needs a distinct rendering contract. Keep template selection and defaults here instead of scattering direct Vento calls through routers.

### Layouts

Locations:

- `src/views/layouts/` for the root landing, error, and shared admin shell.
- `src/views/authenticated/layouts/` for the authenticated application shell.
- `src/views/admin/layouts/` for admin-specific shells.

Layouts define reusable page shells:

- Document structure.
- Shared assets.
- Broad page framing.

Add or change a layout when multiple pages share the same outer structure.

### Pages

Locations:

- `src/views/pages/` for unauthenticated landing and error pages.
- `src/views/authenticated/pages/` for authenticated pages.
- `src/views/admin/pages/` for admin pages.

Pages are route-level Vento templates. They assemble layouts and components for one screen or page mode.

A page should describe composition. It should not contain backend queries or large reusable UI fragments.

### Components

Locations:

- `src/views/components/` for unauthenticated components.
- `src/views/authenticated/components/` for authenticated components.
- `src/views/admin/components/` for admin components.

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

`public/scripts/activity.js` progressively enhances the server-rendered Activity
page: it appends the reusable feed fragment for Load more and updates Thermal
pressed state/counts after a successful toggle. Forms and the ordinary cursor
link remain functional without JavaScript. `activity.css` owns the responsive
feed, search, accomplishment, and Thermal presentation; the Thermal icon is an
inline, repository-native SVG using `currentColor`.

The shared `flightMapPreview.vto` component renders the responsive wide/mobile
thumbnail pair used by Activity flight cards and Profile recent-flight rows.
`app.js` installs a delegated image-error fallback and also repairs images that
failed before the module initialized. Missing or unavailable private objects
therefore remain an image-only standard fallback rather than broken content.

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

After a new flight reaches a completed queue state,
`FlightThumbnailLifecycleService` reloads that flight's persisted Personal
direct/enclosed claim cells and its first/last track points.
`FlightThumbnailService` requests MapTiler's `outdoor-v4` static basemap using
server-side MapTiler Credentials to sign each request, uses the WGS84
ellipsoidal EPSG:6933 transform to align the application grid, and composites
the cells locally with Sharp. Browser-facing map styles continue to use the
public API key. It writes deterministic private WebP
objects at:

```text
<BUCKET_FOLDER>/uploads/<user-id>/thumbnails/<flight-id>-800x450.webp
<BUCKET_FOLDER>/uploads/<user-id>/thumbnails/<flight-id>-450x450.webp
```

Direct cells use 85%-opacity red, enclosed cells use 35%-opacity red, and the
first and last direct cells are green and solid red respectively (striped
green/red when they are the same cell). The track itself and all other flights'
cells are omitted. MapTiler attribution remains visible. Generation is
best-effort and uses a bounded provider request; failure is logged without
reverting flight or queue completion. Admin reprocessing regenerates both
variants after its claim transaction succeeds. Admin flight deletion attempts
both thumbnail deletions inside the existing retryable deletion boundary.

`FlightThumbnailDeliveryService` derives the same keys and signs private GETs
for 24 hours without probing storage on every Activity/Profile read. A signing
failure or missing object falls back per flight and cannot fail the whole page.
The one-off `backfill:flight-thumbnails` command repairs historical or missing
objects with deterministic keyset batches and sequential flight processing; it
is dry-run and missing-only by default, with explicit `--apply` and `--force`
options.

For a newly completed flight, `FlightProcessingService` runs claims,
progression, achievements, leadership, completion timestamping, and the flight
activity insert in one PostgreSQL transaction. The activity's `published_at` is
the database-generated `processed_at`, so a failed insert rolls back completion
and a retry cannot publish a duplicate. Reprocessing does not republish an
existing activity. Feed cards join current flight/profile/Arena data, so
reprocessing can refresh their displayed details while publication order stays
fixed. Deleting a flight cascades to its activity and Thermals. Release 4 does
not backfill activities for flights completed before the feature was deployed.

The activity table is generic for future source types, but the current worker
writes only `flight` activities.

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

Released achievement definitions are exhaustive in
`src/domain/achievement/catalog.ts`. Ordinary awards are permanent and
idempotent. The launch-tag personal-best value is written to
`achievement_records` together with immutable `achievement_record_events` in
one transaction; a new record is awarded only for a strict positive increase.
The live evaluator runs after a claim rebuild while holding the per-user
advisory transaction lock. It counts distinct fixed 500-meter application-grid cells using
EPSG:6933 center `ST_Covers`, ignores invalid denominators for coverage awards,
and never revokes an existing award. Profile reads merge ordinary awards and
record events into one latest-50 achievement list without exposing raw keys or
details. This profile list is separate from the Release 4 Activity feed.

Authenticated profile reads also build an ordered, non-persistent "In progress"
card model. One Arena aggregation calculates Launch Arenas visited, General
Arenas explored, the best valid General coverage ratio, and State/Country
Flown-in counts from fixed 500-meter Personal cells and completed flight origins.
Pure threshold helpers select the next milestone; finished fixed tracks are
omitted while the recurring Personal Map cell milestone remains available.
Dashboard breadcrumbs rank the unfinished cards by completion ratio and show
the closest three. Arena progress reads constrain each Arena lookup to the grid
coordinates inside its bounding box before applying exact `ST_Covers` checks.

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
| Route-level server-rendered screen | Matching family under `src/views/pages/`, `src/views/authenticated/pages/`, or `src/views/admin/pages/` |
| Reusable server-rendered UI | Matching family under `src/views/components/`, `src/views/authenticated/components/`, or `src/views/admin/components/` |
| Shared HTML shell | Matching family under `src/views/layouts/`, `src/views/authenticated/layouts/`, or `src/views/admin/layouts/` |
| Public landing or error view | `src/views/pages/`, `src/views/components/`, `src/views/layouts/`, and `src/views/renderer.ts` |
| Authenticated pilot view | Matching location under `src/views/authenticated/` |
| Admin-only view | Matching location under `src/views/admin/` |
| Authenticated presentation adapter | `src/views/authenticated/adapters/` |
| Page model, renderer, fixture, or presentation-only helper | Matching view family under `src/views/`, `src/views/authenticated/`, or `src/views/admin/` |
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
