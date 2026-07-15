# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, and PostgreSQL web application.
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

### Leaderboard

The leaderboard is based on the current map viewport.

As the user pans and zooms the map, the leaderboard dynamically ranks pilots by
the amount of territory they currently own within the visible portion of the
Competitive Map.

This creates local competition anywhere in the world without predefined regions
or flying sites.

### Initial version scope

Version 1 intentionally remains focused on the core gameplay.

Included features:

- User authentication.
- Upload IGC flight logs.
- Automatic flight processing.
- Personal territory map.
- Monthly competitive territory map.
- Dynamic viewport-based leaderboard.
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
the example environment uses `1000`.

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
