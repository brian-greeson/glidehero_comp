# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, Valkey, and PostgreSQL/PostGIS
web application. It uses server-rendered pages with browser-side MapLibre
interactions, direct object-storage uploads, and separate background workers for
flight processing.

## V1 product overview

### Purpose

Glide Hero transforms GPS flight tracks into a personal exploration and
progression game. Pilots permanently grow their own Personal Map, earn
achievements and personal records, and choose when to compare coverage in
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
After completion, the worker makes a best-effort attempt to generate private
wide and square WebP territory previews from the MapTiler Outdoor basemap.
Preview generation cannot change a successfully completed flight into a failed
one.

### Grid and cell claiming

Glide Hero uses one global, meter-based grid with a permanent 500-meter cell
size, so personal territory and competition ownership always refer to the same
cells.

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
covered each cell. Selecting any covered cell highlights it and shows the latest
flight track for each claimant in that period; when a pilot is selected, only
that pilot's track is shown.

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
same search is available on the Personal page, with a readable Arena type label
and no additional filters.

Any flight that claims a cell in the Arena counts, regardless of its launch
location, when the fixed 500-meter cell center is inside or on the polygon
boundary (`ST_Covers`). State and Country Arenas additionally assign a cell to
exactly one Arena of the same type: the covering Arena with the lexically lowest
`external_id` under PostgreSQL's `C` collation wins. General Arenas may overlap,
and State and Country ownership are independent of each other. The Arena map
hides claims outside this canonical membership, and its leaderboard always
covers the complete Arena. Panning and zooming an Arena never change scoring.

Opening an Arena fits the map to its polygon boundary and draws an outline
around it. A breadcrumb below the main navigation shows `Global >> Arena Name`;
selecting `Global` returns to the viewport-based Global competition. Arena
leaderboards use the same additive coverage rules as Global, but their scoring
scope is the Arena instead of the visible map.

Release 2 Arenas are a single catalog with Launch, General, State, and Country
types. Launch and General pages show the signed-in pilot's personal `x/y` cell
progress beside the competition leaderboard; General Arenas also show a
concise percentage and the next 10/25/50/75/100 coverage milestone for that
Arena (the corresponding achievement is global once-any). Launch pages show
whether the pilot has Visited and the one-time completion state. State and
Country pages show only whether the pilot has Flown in. Progress uses the fixed
500-meter grid-cell center and canonical Arena membership, so cells whose
centers lie on a boundary count. State and Country Arenas do not calculate or
read coverage denominators; any legacy `claimable_cell_count` value on those
rows is ignored.
The first Release 2 catalog rebuild is intentionally destructive and one-time;
the checked-in country (194 policy-selected features), state (50), and launch
sources are imported transactionally by `npm run rebuild:arenas`.

Release 3 adds durable leadership to General, State, and Country Arenas. The
all-time unique-cell result remains the scoring source: pilots tied at the
highest positive cell count are joint leaders. PostgreSQL stores the live
leader projection, the count below the leaders, each leader's latest lead-entry
time, and an internal transition history. Only Arenas affected by newly claimed
cells are evaluated during normal flight processing. Profiles show every
current leadership with the existing Show all/Show fewer behavior. A pilot can
earn Took the Lead and Reclaimed the Lead once each; those achievements remain
after the pilot loses the lead. Launch and viewport-dependent Global competition
do not support durable leadership.

### Release 4 activity and following

Release 4 adds an authenticated Activity page in the main navigation and pilot
following. A pilot can Follow or Unfollow another pilot from that pilot's
profile or from Activity search results. Display names in competition
leaderboards are clickable profile links, where the same Follow/Unfollow control
is available. Following is stored only for other pilots: self-following is
implicit for feed visibility, so there is no self-follow row or self Follow/
Unfollow control, and the product exposes no follower/following counts or lists.

Activity search uses a case-insensitive literal display-name substring, excludes
the current pilot, and returns at most 10 results. The feed includes the current
pilot's own activities and activities from pilots currently followed. Following
someone reveals their earlier Release 4 activity; unfollowing removes it on the
next read. Feed cards are ordered newest first by processing time and use stable
20-item keyset pagination with Load more.

Every newly completed flight publishes exactly one flight activity in the same
transaction as completion. There is no pre-Release 4 activity backfill. A card
links the pilot display name to that pilot's profile and shows the flight date
in its launch time zone, duration, distance, total cells (direct plus enclosed),
and either the matching Launch Arena (with its canonical
link) or launch coordinates rounded to four decimal places. Accomplishments are
grouped from one-time achievement awards, completed milestones, new
personal-record events, and positive `Took the Lead`/`Reclaimed the Lead` events
when entering or re-entering first place; progress that did not award an
achievement, `lost` events, and lower-rank changes are omitted. Reprocessing
refreshes joined card details without changing publication order, and deleting
a flight removes its activity and Likes.

Flight activity cards and Profile recent-flight rows show the same responsive
territory preview: an 800-by-450 image on wider layouts and a 450-by-450 image
on mobile. Each preview contains only that flight's direct and enclosed cells;
it does not render the track or other flights' territory. Missing previews use
one standard image-only fallback. Private preview objects are delivered through
24-hour presigned URLs.

Each activity supports one Like per reacting pilot. The toggle inserts or
removes that pilot's Like and returns the current count; Like actions are
not gated by whether the activity is currently visible in the viewer's feed.
The activity owner can see the count but cannot react to their own activity.
There are no reactor lists. Activities carry a generic source type for future
activity kinds, but Release 4 currently writes only flight activities. Comments,
messaging, reposts, manual posts, photo or video uploads, groups, general-purpose
notifications, and feed preferences remain out of scope.

### Map routes and navigation

- `/` displays login and signup to signed-out visitors. A signed-in request to
  `/` redirects to `/personal`.
- `/global` displays the viewport-based additive coverage competition.
- `/personal` displays the signed-in pilot's permanent Personal Map and
  viewport Stats.
- `/activity` displays the authenticated pilot's followed-and-own activity feed,
  pilot search, and inline Follow/Unfollow controls.
- `/pilots/{user-id}` displays an authenticated pilot profile with inline
  Follow/Unfollow control when the profile belongs to another pilot.
- `/arena/{country-code}/{name}-{source-id}` displays a fixed-area additive
  coverage competition backed by a canonical Arena polygon.
- Signed-out requests to Global, Personal, Activity, Arena, and pilot-profile
  pages redirect to `/`.
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
- Authenticated pilot profiles.
- Persisted flight progression summaries.
- Unique-cell milestones.
- Total-cell and enclosed-cell personal bests.
- Monthly competitive territory map.
- Dynamic viewport-based leaderboard.
- Unified grid- and polygon-authored Arena search and fixed-area leaderboards.
- Arena personal progress and Release 2 exploration achievements.
- Durable General, State, and Country Arena leadership and one-time leadership
  achievements.
- Authenticated pilot following, Activity feed, grouped flight accomplishments,
  and Like reactions.
- Responsive flight territory previews in Activity and Profile recent flights.
- Optional grid overlay and foreground live-position trail on every map.
- Flight statistics after upload.
- Administrative Arena, map-setting, user, and flight-management tools.

Excluded from Version 1:

- Comments.
- Messaging.
- Public signed-out profiles.
- A standalone Arena leadership-history view. Release 3 leadership transitions
  are surfaced in the Release 4 Activity feed only when they are positive
  accomplishments for a completed flight.
- Pilot-facing flight editing or deletion.
- Historical playback.
- Support for file formats other than IGC.

### Product philosophy

Glide Hero is not intended to replace existing flight logging applications.
Instead, it introduces a new way to enjoy flying by rewarding exploration rather
than only long-distance performance.

Every flight has value. Pilots steadily build a permanent Personal Map and
progress through achievements and personal records. Competition remains an
optional way to compare coverage by exploring new areas, regardless of
experience level or cross-country distance.

## Requirements

- Node.js 25.9.0 (`.nvmrc` and `mise.toml` are provided)
- PostgreSQL with PostGIS enabled and permission to create tables in the target database
- Valkey or Redis-compatible storage reachable through a `redis://` or `rediss://` URL
- Private S3-compatible object storage with browser-upload CORS configured
- A MapTiler API key and server-side MapTiler Credentials

## Local setup

```bash
npm install
createdb glidehero
psql glidehero -c 'CREATE EXTENSION postgis'
cp .env.example .env
npm run db:migrate
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
and claims, then generates flight territory previews using MapTiler and object
storage. For object-storage permissions, thumbnail rollout, and CORS
requirements, see
[`docs/flight-upload-deployment.md`](docs/flight-upload-deployment.md).

The grid-cell size is fixed at `500` meters. Arena scoring constructs each claim-cell
center from the application grid and applies `ST_Covers` to `arenas.area`; claim rows
do not persist a per-claim cell size.

Administrators author every Arena at **Areas** using multiple drawn polygons,
reshape/delete controls, GeoJSON import, and a
zoomed-in draft cell preview. Overlapping or edge-adjacent inputs are unioned on
save while disconnected components and imported holes remain.

Refresh the checked-in launch source mirror and create Launch Arenas (Country Arenas
must already be imported; this one-way command rejects existing Launch Arenas):

```bash
npm run import:launches
```

Import the 50 U.S. state Arenas from an official Census boundary GeoJSON file:

```bash
npm run import:state-arenas -- path/to/states.geojson
```

For the one-time Release 2 migration, rebuild all imported Arena types in one
atomic operation. The command validates all three checked-in sources before it
opens the database. It defaults to a full dry-run (the transaction is rolled
back); applying requires both explicit flags:

```bash
npm run rebuild:arenas
npm run rebuild:arenas -- --apply --confirm-delete-all-arenas
```

This migration intentionally deletes every existing Arena, including General
Arenas, then inserts Country, State, and Launch Arenas. It is not an idempotent
synchronizer and is supported for one migration run only. `DATABASE_URL` is
required.

The importer excludes D.C. and territories, uses Census FIPS identity, and
uses the same geometry normalization as the Arena editor. New or edited Arenas immediately include matching
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

Integration tests drop and recreate the `public` and Drizzle migration schemas
in the test database, then apply the checked-in migrations with
`npm run db:migrate` using `DATABASE_URL` set to `TEST_DATABASE_URL`.
Never point `TEST_DATABASE_URL` at development or production data.
## Production notes

Set `ENVIRONMENT=production` so the session cookie receives the `Secure`
attribute. Terminate HTTPS before traffic reaches the application, apply checked-in
migrations with `npm run db:migrate`, and provide configuration through the
deployment secret store. Production requires at least one web process and one
`npm run worker` process sharing PostgreSQL, Valkey, object storage, and
`BUCKET_FOLDER` configuration. The worker also requires `MAPTILER_CREDENTIALS`;
the browser-facing map styles use `MAPTILER_API_KEY` and
permission to write and delete thumbnail objects. The web process requires read
credentials so it can issue private 24-hour thumbnail URLs.
