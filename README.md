# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, Valkey, and PostgreSQL/PostGIS
web application. It uses server-rendered pages with browser-side MapLibre
interactions, direct object-storage uploads, and separate background workers for
flight processing.

## V1 product overview

### Purpose

Glide Hero is a map-based app that transforms GPS flight tracks into a
territory-claiming game. Instead of rewarding only long-distance flights, Glide
Hero encourages exploration by allowing pilots to permanently build their own
map of claimed territory while participating in a lighthearted monthly
competition.

The app is designed so that pilots of all skill levels can make meaningful
progress. A series of small local flights can be just as rewarding as a single
long cross-country flight.

### Core user experience

The experience revolves around a single interactive world map.

Pilots upload one or more IGC flight logs after flying. ZIP archives are unpacked
in the browser and their IGC entries are uploaded individually. The app
automatically analyzes each flight against a shared square grid and records the
cells claimed by its track. No manual selection or editing is required.

Uploads go directly from the browser to private object storage using short-lived
presigned URLs. A Valkey-backed queue hands completed uploads to background
workers, which parse the files and persist flights and claims in PostgreSQL.

### Grid and cell claiming

Glide Hero uses one global, meter-based grid. Its cell size is configured with
`GRID_CLAIM_CELL_SIZE`, so personal territory and competition ownership always
refer to the same cells.

A flight directly claims every cell its track intersects. When those cells form
a closed, edge-connected ring, the fully enclosed cells are claimed as well;
corner contact alone does not close a ring. The same direct and enclosed claims
feed both the personal and competition systems.

### Personal map

The Personal Map is each pilot's permanent, cumulative territory.

Every flight adds its direct and enclosed cells. Claims never remove another
pilot's personal claim, so multiple pilots can independently include the same
cell on their own maps. Adjacent cells are dissolved into regions for display,
while individual grid cells remain the ownership model.

The Personal Map displays only this territory using a color selected by the
pilot. Individual flight tracks are not displayed. Territory is delivered as
on-demand vector tiles once the map reaches the configured minimum zoom.

Each uploaded flight reports statistics including:

- Grid cells claimed directly by the flight.
- Grid cells claimed by closing a loop.
- Flight time.
- Flight distance.

The primary goal of Glide Hero is to give pilots the satisfaction of watching
their personal map gradually grow over time.

### Competitive map

The Competitive Map gives every pilot additive credit for each competition cell
they claim. A cell can count for more than one pilot, so the leaderboard separates
each pilot's claimed cells into exclusive cells and cells shared with other pilots.
Selecting a pilot shows that pilot's coverage; Overview shows how many pilots have
covered each cell. Selecting a covered cell lists its claimants.

Competition pages default to All Time. Current Month limits coverage to claims in
the browser-selected local month, using each flight's stored competition month.

### Global competition and Arenas

The Global competition lives at `/global`. Its additive Territory leaderboard is
based on the current map viewport and refreshes after the map moves. An Arena is a
filtered view of the same coverage data using one canonical EPSG:6933 MultiPolygon. Arena
rankings cover the complete Arena and do not change when its map moves.

Competition pages encode the Current Month selection as `?month=YYYY-MM`; when
the parameter is absent they show All Time. Global and Arena navigation carries
the month parameter between pages.

Grid-painted and polygon-authored Arenas use the same public routes and scoring. Arena
routes use a lowercase ISO country code, a name slug, and the launch source ID,
for example `/arena/us/boulder-745`. The search box on Global and Arena pages is
used exclusively to find Arenas by launch name, city, state, or country. The
Personal page does not display Arena search.

Any
flight that claims a cell in the Arena counts, regardless of its launch
location, when the cell center is inside or on the polygon boundary (`ST_Covers`). The Arena map hides claims outside this polygon membership, and its
leaderboard always covers the complete Arena. Panning and zooming an Arena never
change scoring.

Opening an Arena fits the map to its polygon boundary and draws an outline
around it. A breadcrumb below the main navigation shows `Global >> Arena Name`;
selecting `Global` returns to the viewport-based Global competition. Arena
leaderboards use the same additive coverage rules as Global, but their scoring
scope is the Arena instead of the visible map.

### Map routes and navigation

- `/` displays login and signup to signed-out visitors. A signed-in request to
  `/` redirects to `/personal`.
- `/global` displays the viewport-based additive coverage competition.
- `/personal` displays the signed-in pilot's permanent Personal Map and
  viewport Stats.
- `/arena/{country-code}/{name}-{source-id}` displays a fixed-area additive
  coverage competition backed by a canonical Arena polygon.
- Signed-out requests to Global, Personal, and Arena pages redirect to `/`.
- Invalid or unavailable Arena routes display an Arena 404 page.

The Competitive and Personal controls navigate between `/global` and
`/personal`. Arena pages remain Competitive views; selecting Personal navigates
to `/personal` rather than applying Arena filtering to personal territory.

### Live map flight aids

Every Global, Personal, and Arena map includes optional grid and location
controls. The grid control draws neutral cell outlines over the existing map
without changing claims, scoring, or the selected coverage. Global and Personal
maps request cells for the visible viewport once the map is zoomed in far
enough. Arena maps use the same zoom gate and request only visible cells whose
centers are covered by the Arena polygon. Boundaries remain visible at every zoom.

The location control uses the browser's foreground geolocation support to show
the pilot's current-position dot and one temporary trail. Manual
panning pauses automatic following while location updates and trail collection
continue; selecting the location control again resumes following. Fixes with
accuracy worse than 100 meters are ignored.

The trail is stored only in browser storage and is shared across the app's maps.
It is never uploaded or treated as a flight track. A clear-trail control appears
only when a trail exists. Stopping tracking, leaving the app in the background,
or returning after a long update gap starts a new trail segment so separate
positions are not joined by a misleading line. Background tracking is not
supported.

### Initial version scope

Version 1 intentionally remains focused on the core gameplay.

Included features:

- User authentication.
- Upload IGC flight logs.
- Automatic flight processing.
- Personal territory map.
- Monthly competitive territory map.
- Dynamic viewport-based leaderboard.
- Unified grid- and polygon-authored Arena search and fixed-area leaderboards.
- Optional grid overlay and foreground live-position trail on every map.
- Flight statistics after upload.
- Administrative Arena, map-setting, user, and flight-management tools.

Excluded from Version 1:

- Public profiles.
- Social features.
- Comments or likes.
- Following other pilots.
- Pilot-facing flight editing or deletion.
- Historical playback.
- Support for file formats other than IGC.

### Product philosophy

Glide Hero is not intended to replace existing flight logging applications.
Instead, it introduces a new way to enjoy flying by rewarding exploration rather
than only long-distance performance.

Every flight has value. Pilots steadily build a permanent personal map while
participating in a friendly monthly competition where anyone can compete by
exploring new areas, regardless of experience level or cross-country distance.

## Requirements

- Node.js 25.9.0 (`.nvmrc` and `mise.toml` are provided)
- PostgreSQL with PostGIS enabled and permission to create tables in the target database
- Valkey or Redis-compatible storage reachable through a `redis://` or `rediss://` URL
- Private S3-compatible object storage with browser-upload CORS configured
- A MapTiler API key

## Local setup

```bash
npm install
createdb glidehero
psql glidehero -c 'CREATE EXTENSION postgis'
cp .env.example .env
npm run db:push -- --force
```

Fill in the Valkey, object-storage, and MapTiler values in `.env` before
starting the application. Then keep the web process and flight processor
running in separate terminals:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run dev:worker
```

Both processes use the same `.env`. The web process creates upload intents and
serves status; the worker consumes queued uploads and writes completed flights
and claims. For object-storage permissions and CORS requirements, see
[`docs/flight-upload-deployment.md`](docs/flight-upload-deployment.md).

`GRID_CLAIM_CELL_SIZE` is required and specifies the grid-cell size in meters;
the example environment uses `500`. Arena scoring constructs each claim-cell
center from that claim's stored size and applies `ST_Covers` to `arenas.area`.

Administrators author every Arena at **Areas** using multiple drawn polygons,
reshape/delete controls, GeoJSON import, and a
zoomed-in draft cell preview. Overlapping or edge-adjacent inputs are unioned on
save while disconnected components and imported holes remain.

Refresh launch metadata for existing launch-backed Arenas without changing their polygon:

```bash
npm run import:launches
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ingest/importLaunchAreas.sql
```

Import the 50 U.S. state Arenas from an official Census boundary GeoJSON file:

```bash
npm run import:state-arenas -- path/to/states.geojson
```

The importer excludes D.C. and territories, upserts by Census FIPS identity,
preserves UUID/source IDs on rerun, and uses the same geometry normalization as
the Arena editor. New or edited Arenas immediately include matching
historical global claims; flight parsing never assigns claims to Arenas.

Open <http://localhost:3000>. Create an account, log out, and log back in.
The process health endpoint is <http://localhost:3000/v1/up>.

For code organization and dependency boundaries, see
[`docs/architecture.md`](docs/architecture.md).

## Validation

Create a separate disposable test database, then run:

```bash
createdb glidehero-test
npm test
TEST_DATABASE_URL=postgres://localhost/glidehero-test npm run test:integration
npm run typecheck
npm run build
```

Integration tests drop and recreate the `public` schema in the test database, then run
`npm run db:push -- --force` with `DATABASE_URL` set to `TEST_DATABASE_URL`.
Never point `TEST_DATABASE_URL` at development or production data.

## Production notes

Set `ENVIRONMENT=production` so the session cookie receives the `Secure`
attribute. Terminate HTTPS before traffic reaches the application, apply checked-in
migrations with `npm run db:migrate`, and provide configuration through the
deployment secret store. Production requires at least one web process and one
`npm run worker` process sharing PostgreSQL, Valkey, object storage,
`GRID_CLAIM_CELL_SIZE`, and `BUCKET_FOLDER` configuration.
