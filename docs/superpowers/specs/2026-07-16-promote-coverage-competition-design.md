# Promote Coverage to the Main Competition

## Goal

Replace the existing latest-owner competition experience with the accepted additive coverage experience. The promoted experience becomes the only competitive mode. No retired route, filename, selector, message, label, or compatibility redirect remains.

Personal territory and competition claim persistence are unchanged. The refactor changes the competition read model, HTTP delivery, and presentation only.

## Product behavior

The promoted mode preserves the accepted coverage behavior:

- The navigation mode is labeled **Competitive**.
- The primary card is titled **Coverage leaderboard**.
- Users can view All Time or Current Month coverage.
- The Global leaderboard and coverage are filtered to the current viewport.
- Arena leaderboards and coverage are filtered to the selected Arena.
- Selecting a pilot shows that pilot's additive coverage.
- Overview, pilot colors, Arena boundaries, cell claimant popups, mobile sheet behavior, and responsive popup placement remain unchanged.
- The Personal mode remains unchanged.

The existing latest-owner competition map, leaderboard, and stats presentation are removed. Competition claim history remains the source data for additive coverage.

## Canonical pages and routes

The existing public page URLs remain canonical:

- `GET /global` renders the Global additive-coverage competition.
- `GET /arena/:countryCode/:arenaSlug` renders the Arena additive-coverage competition.
- `GET /personal` retains its current behavior.

All former experimental pages and APIs are removed without redirects and fall through to the application's normal `404` handling.

The canonical competition APIs serve the promoted coverage behavior:

- `GET /v1/competition-leaderboard` returns viewport-filtered Global coverage rankings.
- `GET /v1/competition-territory` returns Global overview or selected-pilot coverage.
- `GET /v1/arenas/:sourceId/competition-leaderboard` returns Arena coverage rankings.
- `GET /v1/arenas/:sourceId/competition-territory` returns Arena overview or selected-pilot coverage.
- `GET /v1/competition-cells/:x/:y/claimants` returns the pilots who contributed coverage to a cell.

The APIs retain All Time as the absence of `month` and Current Month as a validated `month=YYYY-MM` query. Global leaderboard requests also retain validated viewport bounds. Territory requests accept an optional validated pilot UUID.

## Architecture and components

The additive coverage queries remain in the service layer and continue to read competition claim history. No database schema change, migration, backfill, or claim-data rewrite is required.

The standalone experimental router and page renderer are removed. Canonical competition routes are owned by `src/web/webRouter.ts`, and the promoted pages are rendered through the normal page renderer in `src/views/renderer.ts`.

The main Global and Arena templates adopt the coverage map and leaderboard markup. Shared browser behavior is kept in focused competition-coverage modules used by both pages. The Global and Arena entry scripts supply their page-specific setup while reusing the same controller, API URL builders, map behavior, and leaderboard rendering.

All experimental files and symbols are deleted or renamed to product-facing competition or coverage names. Old latest-owner browser modules, view components, and styles are deleted once no canonical page consumes them. Shared modules that remain useful to Personal mode or other features are retained.

## Request and interaction flow

For Global competition:

1. The page initializes the map and competition period control.
2. The browser requests the canonical Global coverage leaderboard using the map bounds and selected period.
3. Overview renders aggregate coverage; selecting a pilot requests and renders that pilot's cells.
4. Map movement refreshes the viewport leaderboard while preserving the selected period and current interaction state.
5. Selecting a coverage cell requests its claimants from the canonical cell-claimants endpoint and anchors the popup using the existing responsive placement behavior.

For an Arena:

1. The page resolves the Arena from the canonical route and fits the map to its boundary.
2. The browser requests the canonical Arena leaderboard for the selected period.
3. Overview and pilot selection request Arena-filtered territory.
4. The Arena boundary remains visible alongside coverage.
5. Cell claimant popup behavior matches Global competition.

Existing abort and latest-request guards continue preventing stale responses from replacing newer map or period selections.

## Error handling

- Anonymous page requests redirect to `/`.
- Anonymous API requests return `401` without querying coverage.
- Invalid periods, viewport bounds, pilot IDs, Arena source IDs, or cell coordinates return focused `400` responses.
- Missing Arenas return `404`.
- Removed experimental URLs use the normal application `404`; they do not redirect.
- Browser request failures preserve the current coverage error and retry messaging without experimental terminology.

## Tests and verification

Tests migrate with the promoted behavior instead of being discarded:

- Router tests verify canonical competition endpoints call the additive coverage service with validated periods, bounds, pilots, Arenas, and cells.
- Page and renderer tests verify `/global` and Arena pages contain the promoted coverage UI, canonical links, and renamed scripts.
- Browser tests cover URL construction, Overview, pilot selection, leaderboard rendering, map colors, claimant popups, period changes, stale-request protection, and mobile popup placement.
- Integration tests continue verifying additive coverage calculations against PostgreSQL/PostGIS for Global and Arena scopes.
- Application tests continue verifying that unmatched page and API URLs use normal `404` handling; obsolete route literals are not retained in the test suite.
- Existing Personal behavior tests remain unchanged and passing.
- The full project test suite, type checking, and build must pass.
- A case-insensitive repository search for the retired experimental term must return no tracked source, test, documentation, style, or script references.

## Documentation

The README competition sections are updated to describe additive pilot coverage, Overview and pilot selection, All Time and Current Month periods, viewport-filtered Global competition, Arena filtering, and cell claimant details. Descriptions of latest-owner competition behavior are removed where they describe the replaced read experience.

## Out of scope

- Changing how personal claims are stored or displayed.
- Changing how competition claim history is written.
- Database migrations, data cleanup, or backfills.
- Historical playback beyond the existing All Time and Current Month controls.
- Redirects or compatibility aliases for former experimental URLs.
- New competition features or visual redesign beyond promoting and renaming the accepted coverage experience.
