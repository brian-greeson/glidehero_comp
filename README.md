# GlideHero

GlideHero turns paraglider GPS tracks into a persistent exploration game.
Pilots upload IGC flight logs, grow personal territory, track achievements and
records, and compare coverage with other pilots.

The application is built with Node.js, Express, Vento, Drizzle, Valkey, and
PostgreSQL/PostGIS. It uses server-rendered pages with browser-side enhancements,
private object storage for flight files and generated images, and background
workers for flight processing.

## Features

### Flight processing

- Regular multi-IGC uploads for flights from the previous 30 launch-local
  calendar days, processed in chronological order.
- Bulk historical ZIP imports for flights of any age, with durable progress
  and retryable achievement recalculation.
- Direct browser uploads to private object storage.
- Asynchronous parsing, duplicate detection, scoring, and claim generation.
- Flight summaries, distance scores, and private territory previews.

### Personal exploration

- A permanent personal territory map built from every completed flight.
- A shared, meter-based grid used consistently across the application.
- Direct claims from the flight path and additional claims for enclosed areas.
- Personal records, milestones, Arena progress, and achievements.

### Competition and Arenas

- Global, monthly, all-time, and following-scoped coverage comparisons.
- Additive scoring: more than one pilot may receive credit for the same cell.
- Viewport-based global rankings and fixed-area Arena rankings.
- Launch, general, state, and country Arenas backed by canonical PostGIS
  geometry.
- Durable Arena leadership for supported Arena types.

### Pilot community

- Authenticated pilot profiles and following.
- An activity feed based on completed flights and accomplishments.
- Reactions to eligible activity.
- Catalog-validated glider details with flight-hour tracking.

### Maps and flight review

- Interactive personal, competition, Arena, and individual-flight maps.
- On-demand vector-tile delivery for territory.
- Historical flight replay and selected-cell flight context.
- Optional browser-local mapping aids that do not affect recorded flights or
  scoring.

### Administration and operations

- Administrative management for pilots, flights, Arenas, application settings,
  and worker processing.
- Dry-run-first scripts for imports, backfills, verification, and history
  rebuilds.

## Product principles

GlideHero rewards exploration rather than only distance. Every valid flight can
contribute to a pilot's permanent map and progression, while competition remains
an optional way to compare coverage.

The product complements dedicated flight-log applications rather than replacing
them. IGC processing, territory, progression, and map-based discovery are the
core focus.

## Requirements

- Node.js 25.9.0 (`.nvmrc` and `mise.toml` are provided)
- PostgreSQL with PostGIS
- Valkey or Redis-compatible storage
- Private S3-compatible object storage
- MapTiler browser and server credentials

## Local setup

```bash
npm install
createdb glidehero
psql glidehero -c 'CREATE EXTENSION postgis'
cp .env.example .env
npm run db:migrate
```

Fill in the required database, Valkey, object-storage, and MapTiler values in
`.env`. Run the web application and worker in separate terminals:

```bash
npm run dev
```

```bash
npm run dev:worker
```

Open <http://localhost:3000>. The health endpoint is
<http://localhost:3000/v1/up>.

Use checked-in migrations for schema changes:

```bash
npm run db:generate
npm run db:migrate
```

Do not use `npm run db:push`.

## Validation

Create a disposable test database, then run:

```bash
createdb glidehero-test
npm test
TEST_DATABASE_URL=postgres://localhost/glidehero-test npm run test:integration
npm run typecheck
npm run build
```

Integration tests recreate schemas in `TEST_DATABASE_URL`. Never point that
variable at development or production data.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) describes code organization,
  dependency boundaries, and file placement.
- [`docs/flight-upload-deployment.md`](docs/flight-upload-deployment.md)
  describes upload infrastructure, production rollout, and data-maintenance
  procedures.
- [`docs/thermal-data.md`](docs/thermal-data.md) describes Thermal.kk raster
  caching, the dedicated processing worker, and admin crawl jobs.

## Production

Production requires web and worker processes sharing PostgreSQL, Valkey, object
storage, and consistent application configuration. Apply checked-in migrations
with `npm run db:migrate`, provide secrets through the deployment platform, and
set `ENVIRONMENT=production`.

See the deployment guide for detailed storage permissions, worker operations,
backfills, and release procedures.
