# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, valkey, and PostgreSQL web application.
The first milestone provides server-rendered email/password signup and login using
revocable HTTP-only cookie sessions.

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

Pilots upload IGC flight logs after flying. The app automatically analyzes each
flight against a shared square grid and records the cells claimed by its track.
No manual selection or editing is required.

Every uploaded flight is processed automatically and becomes a permanent part
of the pilot's history.

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

The Personal Map displays only this territory using a color selected
by the pilot. Individual flight tracks are not displayed.

Each uploaded flight reports statistics including:

- Grid cells claimed directly by the flight.
- Grid cells claimed by closing a loop.
- Flight time.
- Flight distance.

The primary goal of Glide Hero is to give pilots the satisfaction of watching
their personal map gradually grow over time.

### Competitive map

The Competitive Map provides a lightweight monthly competition.

Instead of permanently owning territory, pilots compete to control territory
during the current month.

Each cell has one current owner per month. Ownership goes to the latest direct
or enclosed claim according to the flight timestamps in the IGC file, not the
upload time, so a later flight can take a cell from its current owner.

Claims are assigned to calendar months using the local time zone of each
flight's launch location. Only that month's latest claims determine the map, so
ownership starts fresh each month while prior claim history remains recorded.

Every pilot is displayed using a distinct map color to make ownership easy to
understand.

### Global competition and Arenas

The Global competition lives at `/global`. Its leaderboard and Competitive
Stats are based on the current map viewport. As the user pans and zooms the
Global map, the app dynamically recalculates rankings, claimed area, contributing
flights, pilots, and the signed-in pilot's contributing flights for the visible
area. Competition pages default to All Time, where the latest claimant across
the complete recorded history owns each cell. Pilots can switch the map,
leaderboard, and Stats together to Current Month. Competition pages encode that
selection as `?month=YYYY-MM`; when the parameter is absent they show All Time.
Global and Arena navigation carries the month parameter between pages.

Launch areas with generated grid geometry are also available as Arenas. Arena
routes use a lowercase ISO country code, a name slug, and the launch source ID,
for example `/arena/us/boulder-745`. The search box on Global and Arena pages is
used exclusively to find Arenas by launch name, city, state, or country. The
Personal page does not display Arena search.

An Arena is a filtered view of the same global competition ownership for the
selected time period. Any
flight that claims a cell in the Arena counts, regardless of its launch
location. The Arena map hides claims outside its exact cell membership, and its
leaderboard and Stats always cover the complete Arena. Panning and zooming an
Arena never change scoring.

Opening an Arena fits the map to its generated boundary and draws an outline
around it. A breadcrumb below the main navigation shows `Global >> Arena Name`;
selecting `Global` returns to the viewport-based Global competition. Arena
leaderboards use the same ranking, tie, top-ten, color, and current-pilot rules
as Global, but their scoring scope is the Arena instead of the visible map.

### Map routes and navigation

- `/` displays login and signup to signed-out visitors. A signed-in request to
  `/` redirects to `/global`.
- `/global` displays the viewport-based monthly competition.
- `/personal` displays the signed-in pilot's permanent Personal Map and
  viewport Stats.
- `/arena/{country-code}/{name}-{source-id}` displays a fixed-area monthly
  competition backed by a generated launch area.
- Signed-out requests to Global, Personal, and Arena pages redirect to `/`.
- Invalid or unavailable Arena routes display an Arena 404 page.

The Competitive and Personal controls navigate between `/global` and
`/personal`. Arena pages remain Competitive views; selecting Personal navigates
to `/personal` rather than applying Arena filtering to personal territory.

### Initial version scope

Version 1 intentionally remains focused on the core gameplay.

Included features:

- User authentication.
- Upload IGC flight logs.
- Automatic flight processing.
- Personal territory map.
- Monthly competitive territory map.
- Dynamic viewport-based leaderboard.
- Launch-area Arena search and fixed-area leaderboards.
- Flight statistics after upload.

Excluded from Version 1:

- Public profiles.
- Social features.
- Comments or likes.
- Following other pilots.
- Flight editing or deletion.
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

## Local setup

```bash
npm install
createdb glidehero
psql glidehero -c 'CREATE EXTENSION postgis'
cp .env.example .env
npm run db:push -- --force
npm run dev
```

`GRID_CLAIM_CELL_SIZE` is required and specifies the grid-cell size in meters;
the example environment uses `1000`. Arena generation uses this same value so
Arena membership can be joined directly to competition claims by cell size and
grid coordinates.

To populate launch-backed Arenas, import launch data and metadata, then generate
the exact Arena cells using the same configured competition cell size:

```bash
npm run import:launches
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f injest/importLaunchAreas.sql
npm run generate:launch-areas
```

Only launch areas with generated geometry and cell membership appear in Arena
search results. `generate:launch-areas` accepts an optional positive odd grid
count and defaults to a `5x5` area centered on each launch. Rerunning it replaces
the previously generated launch-area cells and boundaries.

Open <http://localhost:3000>. Create an account, log out, and log back in.
The process health endpoint is <http://localhost:3000/v1/up>.

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
attribute. Terminate HTTPS before traffic reaches the application, run
`npm run db:push -- --force` to synchronize the target database before starting a
new release, and provide `DATABASE_URL` through the deployment secret store.
