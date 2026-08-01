# GlideHero Architecture

This guide describes the durable architecture of the repository. It is intended
to help contributors place new behavior, preserve dependency boundaries, and
extend existing patterns without tying the architecture to a particular page or
UI control.

## Architecture at a glance

GlideHero is a server-rendered Express application with browser-side JavaScript
for interactive behavior. PostgreSQL with PostGIS is the system of record,
Drizzle provides database access, and Vento renders HTML. Private S3-compatible
object storage holds uploaded flight files and generated images. Valkey provides
transient upload state and the background work queue.

The application processes are:

- A web process that serves HTML and data endpoints, authenticates users, and
  accepts upload intents.
- A worker process that consumes queued flights and performs durable processing.
- An optional thermal worker that fills targeted raster-cache jobs and converts
  cached native tiles into queryable PostGIS lift areas.

A typical web request follows this path:

```text
Browser
  -> Express middleware
  -> Router
  -> Service
  -> Domain logic and/or infrastructure
  -> HTML or data response
```

Flight ingestion crosses both processes:

```text
Browser
  -> upload intent from web process
  -> private object storage
  -> object verification and minimal IGC parsing
  -> pending flight and workflow member in PostgreSQL
  -> chronological activation in Valkey work queue
  -> worker
  -> flight processing services
  -> PostgreSQL/PostGIS
```

Dependencies should generally point inward:

- Delivery code calls services.
- Services coordinate domain logic and infrastructure.
- Domain code remains independent of Express, Vento, Drizzle, and browser APIs.
- Presentation code receives prepared data and does not query persistence.

## Runtime composition

### Web process

`src/index.ts` is the web composition root. It validates configuration, creates
infrastructure clients, constructs services and HTTP dependencies, and starts
the server.

`src/app.ts` owns application-wide Express policy, including middleware
ordering, static files, router mounting, not-found behavior, and centralized
error handling.

Keep both files focused on composition. Business rules, database queries, and
request-specific behavior belong in their owning layers.

### Worker process

`src/worker.ts` is the worker composition root. It creates the dependencies
needed to consume and process flight jobs.

Worker lifecycle code belongs in the service layer. It coordinates queue
consumption, maintenance work, recovery, and graceful shutdown while keeping
the executable entry point small.

The web and worker processes share durable state and configuration, but they do
not share in-memory state.

### Thermal data process

`src/thermalWorker.ts` is the composition root for the independently operated
thermal worker. The web process serves cached raster tiles and records native
zoom-12 tiles as pending. The thermal worker claims short database leases,
vectorizes those rasters, and writes versioned relative-activity areas to
PostGIS. It also fills admin-targeted crawl jobs when no cached raster is
waiting for processing.

Raster objects live beneath
`<BUCKET_FOLDER>/thermal_tiles/thermals_all_all/{z}/{x}/{tms-y}.png`. PostgreSQL
stores cache metadata, crawl progress, processing ownership, and vector areas;
object storage remains the source of the raster bytes. See
`docs/thermal-data.md` for operating details.

## Configuration

Configuration lives under `src/config/`, with developer-facing variables
documented in `.env.example`.

Configuration code owns:

- Environment-variable parsing and validation.
- Defaults and normalization.
- Typed application-facing configuration.

Code outside the configuration layer should receive values through explicit
arguments rather than reading `process.env` directly. New required settings
must be represented in both the typed configuration and `.env.example`.

## HTTP delivery

Locations:

- `src/web/` for the main application HTTP surface.
- `src/routes/` for small standalone operational routes.
- `src/middleware/` for application-wide Express middleware.

Routers own:

- Paths and HTTP methods.
- Authentication and authorization at the request boundary.
- Parsing and validating untrusted input.
- Calling services.
- Status codes, redirects, and response formats.
- Adapting service results into presentation models.

Routers should not contain substantial SQL or reusable business rules. If
behavior matters outside a particular HTTP request, place it in a service or
the domain.

Middleware owns request-lifecycle concerns such as current-user resolution,
session behavior, logging, and other cross-cutting HTTP policy. It may enrich
request context or enforce policy, but should delegate application use cases to
services.

## Service layer

Location: `src/services/`

Services implement application use cases and coordinate work across domain
logic, persistence, queues, and external resources.

Services own:

- Feature workflows.
- Transaction boundaries.
- Feature-specific Drizzle and PostGIS queries.
- Multi-step persistence.
- Coordination with queues and object storage.
- Application-facing interfaces and result types.

This repository does not use a separate repository layer. A feature-specific
query belongs in the service that owns the use case. Extract a shared query only
when there is a genuine shared responsibility; do not group unrelated
persistence behavior merely because its SQL is similar.

Services must not depend on Express request or response objects, Vento
templates, the DOM, or browser APIs. External dependencies should be passed
explicitly, usually through a focused factory.

When a feature spans layers, implement it as a thin vertical slice:

1. Add the smallest useful entry point.
2. Add the service behavior it requires.
3. Add the minimal domain or persistence behavior.
4. Return a real result through the entry point.
5. Verify the integrated path.
6. Add further behavior one observable slice at a time.

## Domain layer

Location: `src/domain/`

Domain modules contain framework-independent concepts, rules, calculations,
parsing, normalization, and transformations. Current domains include flight
parsing, territory, competition, Arenas, achievements, gliders, launches, and
search.

Domain functions should generally:

- Accept and return plain values.
- Be deterministic where practical.
- Use focused domain errors.
- Avoid database, HTTP, filesystem, template, and browser dependencies.

Feature subdirectories should group cohesive concepts. A database query does
not move into the domain merely because it implements a business rule; keep the
query in a service and extract only its pure calculations or transformations.

Checked-in reference data under `data/` is an application input. Parsing and
validating that data belongs with the domain that understands it.

## Persistence

Locations:

- `src/db/`
- `drizzle/`
- `drizzle.config.ts`

The persistence foundation owns database-wide structure:

- Tables, columns, constraints, indexes, enums, and sequences.
- Drizzle relations and database-derived types.
- PostgreSQL connection setup.
- PostGIS type integration.
- Ordered migration artifacts.

Feature queries and transactions remain in services.

PostgreSQL with PostGIS is the authoritative store for users, flights, claims,
territory, Arenas, progression, activity, and other durable application state.
Use database constraints and indexes to enforce invariants that must hold even
when a service is bypassed.

The application uses Drizzle ORM and Drizzle Kit 1.0 release candidates. Use
version 1.0 or later documentation and APIs. Schema changes must be generated
and applied through checked-in migrations:

```bash
npm run db:generate
npm run db:migrate
```

Do not use `npm run db:push`.

### Spatial model

The application uses a shared grid in a meter-based coordinate system. Flight
claims are stored independently of any particular view, and PostGIS evaluates
territory, viewport, and Arena membership.

Arena geometry is canonical database state. Arena reads project global claims
through that geometry rather than copying claims into Arena-specific ownership
tables. Derived progress and leadership tables are rebuildable projections,
not alternative sources of scoring truth.

Keep coordinate systems, boundary rules, and grid construction consistent
across write paths, queries, backfills, and map delivery. Spatial persistence
and transaction behavior require integration coverage against real PostGIS.

## External resources

Location: `src/resources/`

Resource modules adapt external systems such as Valkey, object storage, and
third-party HTTP services. They own client construction and provider-specific
configuration, while services own application workflows that use those clients.

Keep provider details behind narrow application-facing interfaces. Resource
modules should not decide product rules or render responses.

External state has different durability:

- PostgreSQL is authoritative durable application state.
- Object storage holds private source and generated file artifacts.
- Valkey holds transient workflow state and queued work.
- Browser storage may hold local-only convenience state and is never
  authoritative.

## Flight-processing pipeline

The upload and processing pipeline is deliberately asynchronous and has two
user-facing entry paths:

- A regular upload accepts one or more IGC files. Each flight must fall within
  the inclusive 30-day launch-local calendar window. A user's sealed regular
  batches merge into one queue ordered by `started_at`, then flight UUID.
- A bulk historical upload accepts one ZIP in the browser, expands its IGC
  members, and accepts flights of any age. Only one bulk import may remain
  active for a user. Its valid flights are processed in the same deterministic
  order; invalid and duplicate members do not stop later flights.

Both paths use the same durable preparation sequence:

1. The web process authenticates the pilot and creates an open regular batch or
   preparing bulk import.
2. The browser uploads each IGC directly to private object storage.
3. The web process verifies the object, parses enough IGC data to determine the
   flight time and launch timezone, and calculates the content hash.
4. One short PostgreSQL transaction creates `igc_files`, a `flights` row with
   `pending` processing status, and its workflow member.
5. After the browser seals the workflow, PostgreSQL atomically claims only the
   oldest eligible member. Valkey receives that member's job only after the
   claim succeeds.
6. A worker downloads the object and changes the prepared flight from
   `pending` to `processing` before performing the expensive calculations.
7. The flight transaction persists track, score, territory, progression, and
   terminal flight state. Terminal workflow state then releases the next
   chronological member.
8. Queue state records the outcome for status reporting, cleanup, and recovery.

The database transaction is the boundary for durable completion. Optional
generated artifacts must not turn an already committed flight into a failed
flight.

Queue consumers must remain restart-safe and safe to scale horizontally.
Recovery, cleanup, retries, acknowledgements, and terminal-state reconciliation
belong in the worker services rather than in the entry point.

### Upload workflow state

`flightUploadWorkflowService` owns durable scheduling state:

- `regular_upload_batches` and `regular_upload_members` provide the shared
  per-user regular queue. A partial unique index permits only one processing
  regular member per user.
- `bulk_imports` and `bulk_import_members` provide the historical-import
  lifecycle. Preparing, processing, replaying, and failed imports remain active,
  so a second import cannot begin prematurely.
- `user_workflow_state.dirty_achievement_boundary` coalesces chronological
  correction work to the earliest affected flight, while `dirty_revision`
  prevents replay from clearing work requested by a concurrent flight.

PostgreSQL is the scheduling authority. Valkey stores upload status and delivers
only the currently activated job. Workflow members also act as a durable outbox:
maintenance can reconstruct missing Valkey state from `igc_files`, `flights`,
and the member row. Claimed-member reconciliation settles terminal flights and
reactivates pending flights after a failed handoff or worker interruption. If
Valkey loses a job after PostgreSQL fenced its flight as `processing`,
maintenance atomically returns the flight and member to `pending` before
reactivating it with a new processing token.
Open regular batches and preparing bulk imports can be cancelled and expire
after the abandoned-upload window. Admission locks the accepting workflow row,
and sealing, claiming, replay, cancellation, and expiry require an explicit
non-terminal phase so late browser requests cannot revive cancelled work.
Globally duplicate content never references the existing pilot's flight or joins
the new pilot's workflow. Its redundant object uses the retryable removal
tombstone before deletion.

### Activity and achievement ordering

Regularly uploaded flights publish their Activity row transactionally when the
flight completes. Bulk historical flights never publish Activity rows.

Achievement evaluation is deferred for every bulk flight and for regular
flights completed while a bulk import or chronological correction is active.
After bulk flight processing finishes, all completed flights are replayed by
`started_at`, then flight UUID. A backdated regular upload uses the earliest
dirty boundary to replay only the affected suffix. Activity rows and reactions
are not deleted or recreated by either replay mode.

Achievement replay commits at most three flights per transaction. For bulk
imports, the replay cursor is updated in the same transaction as those three
flights. The last transaction also completes or restarts the import, eliminating
a checkpoint-to-finalization crash window. A replay failure keeps the import
active and maintenance retries it from the last committed cursor. If a regular
flight completes during the full replay, the dirty revision atomically restarts
the replay before the import can be completed.

Admin deletion takes the per-user progression lock and refuses completed-flight
deletion while a bulk replay, failed resumable replay, or dirty suffix correction
is active. This keeps the ordered flight list stable across replay checkpoints.

## Server-rendered presentation

Location: `src/views/`

Views are separated into public, authenticated, and administrative families.
Each family may contain pages, layouts, reusable components, renderers, fixtures,
and presentation adapters.

Presentation code owns:

- Vento templates and shared HTML structure.
- Page-specific view models.
- Formatting and display-only transformations.
- Reusable presentation components.

Presentation code must not access the database or make authorization decisions.
Routers and services prepare the data it receives.

Prefer an existing component when its semantics match. Create a new component
when a cohesive presentation pattern has more than one use or a clear reuse
path. Keep feature-specific presentation with its view family rather than
creating a global bucket.

## Browser presentation

Locations:

- `public/scripts/`
- `public/styles/`
- Other static assets under `public/`

Browser modules own DOM behavior, client-side state, fetch calls, interactive
maps, and progressive enhancement. Stylesheets own shared and feature-specific
presentation.

Server-rendered markup, browser modules, and styles form one presentation
contract. Use stable data attributes and small, focused modules to connect
them.

The browser is not an authorization or data-integrity boundary. Server
endpoints must repeat authoritative validation and access checks.

Map data and territory rules remain server-owned. Browser code controls
presentation, interaction, and request timing; it must not become a competing
implementation of scoring or spatial rules. Values returned from mapping
libraries should be converted to plain response or source data before crossing
serialization boundaries.

## Scripts and operational workflows

Location: `src/scripts/`

Scripts are executable entry points for imports, backfills, rebuilds,
verification, and maintenance.

Scripts should:

- Reuse services and domain behavior instead of duplicating it.
- Validate configuration and command input before mutation.
- Default to dry-run for large or destructive operations when practical.
- Make apply modes and destructive behavior explicit.
- Process large datasets in bounded batches.
- Report progress, results, and partial-failure behavior.
- Have a corresponding `package.json` command when intended for operators.

Release ordering, worker coordination, and command-specific safeguards belong
in operational documentation, not in this architecture guide. See
[`flight-upload-deployment.md`](flight-upload-deployment.md).

## Shared types

Location: `src/types/`

Use this directory for ambient declarations or compatibility types that apply
across the application. Feature-owned interfaces and result types should stay
near their service, domain module, or presentation adapter.

Avoid a general type bucket for types with a clear owner.

## Tests

Locations:

- `test/unit/`
- `test/integration/`
- `test/support/`
- `test/inputs/`

Unit tests cover pure domain rules and isolated service, router, renderer, and
browser contracts.

Integration tests cover real database behavior, transactions, constraints,
PostGIS queries, migrations, and complete persistence paths.

Test support contains reusable test infrastructure. Test inputs contain stable
fixtures, including IGC resources; fixtures are not product code.

Tests should follow the changed behavior. Pure calculations need focused unit
coverage, while SQL, constraints, transactions, geometry, and end-to-end
persistence need integration coverage.

## File-placement guide

| Behavior or artifact | Location |
| --- | --- |
| Process construction and web startup | `src/index.ts` |
| Worker construction and startup | `src/worker.ts` |
| Application-wide Express policy | `src/app.ts` |
| Typed environment configuration | `src/config/` |
| HTTP routes and boundary validation | `src/web/` |
| Small standalone operational routes | `src/routes/` |
| Application-wide middleware | `src/middleware/` |
| Application workflow or feature query | `src/services/` |
| Pure business rule or transformation | `src/domain/<feature>/` |
| Schema, relation, database type, or client | `src/db/` |
| External client adapter | `src/resources/` |
| Public server-rendered presentation | `src/views/` |
| Authenticated presentation | `src/views/authenticated/` |
| Administrative presentation | `src/views/admin/` |
| Browser behavior | `public/scripts/` |
| Styling | `public/styles/` |
| Static browser asset | `public/` |
| Import, backfill, rebuild, or verification command | `src/scripts/` |
| Ambient or third-party compatibility declaration | `src/types/` |
| Isolated behavior test | `test/unit/` |
| Database, PostGIS, or full persistence test | `test/integration/` |

## Boundaries to preserve

- Routers translate HTTP; services execute use cases.
- Services own feature persistence; domain modules remain
  infrastructure-independent.
- Templates and presentation adapters present prepared data; they do not fetch
  it.
- Browser code enhances the interface; it does not enforce authorization or
  durable business rules.
- Composition roots wire dependencies; constructors and factories should not
  hide global environment reads.
- PostgreSQL is authoritative; Valkey, generated artifacts, and browser-local
  state are supporting concerns.
- Shared code should have a real second consumer or a clear domain identity.
- Avoid placeholder repositories, generic utility buckets, and abstractions
  created only to make the folder tree look layered.
- Preserve public HTTP and data contracts unless the task explicitly changes
  them.
- Prefer small, feature-focused vertical slices over building entire layers in
  isolation.
