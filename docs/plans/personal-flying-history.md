# Personal flying history implementation plan

## Product contract

`/personal` is the authenticated pilot's self-scoped flying history. It should
feel like an accumulated flying life rather than another pilot filter on the
shared map.

- Primary navigation is Map, Plan, My Flights, and Profile. Activity and
  Achievements remain available by direct route but are not primary navigation
  items.
- My Flights is a dedicated `/personal` destination and is removed from the
  Map pilot filter. The Map filter contains Following and All Pilots.
- Initial defaults are Following: Month + Latest, My Flights: All Time +
  Latest, and All Pilots: Month + Distance. Explicit filter selections carry
  between Following and All Pilots.
- Unless a later requirement says otherwise, distance means five-point
  distance throughout GlideHero.
- My Flights time modes are mutually exclusive: All Time, Year, Month, and
  Custom Range. There is no Season filter.
- My Flights summaries are Total flights, five-point Distance flown, Airtime,
  Launches visited, and Countries visited. Every summary respects every active
  filter, including map-area and launch filters.
- Countries are determined from each flight's launch point. A flight with an
  Unknown launch still contributes when its launch point falls in a known
  country. Regions are not part of the feature.
- A flight belongs to the nearest catalog launch within 1,000 meters. A flight
  without a catalog launch in that radius is an Unknown launch. Only catalog
  launches count toward Launches visited.
- The My Flights launch filter contains visited catalog launches plus Unknown
  launch. It does not contain unvisited catalog launches.
- Every catalog launch is available as a shared map layer on My Flights,
  Following, and All Pilots. The layer is visible by default, can be toggled,
  and stores its state in the URL.
- Selecting a launch opens its information without filtering flights. The
  panel shows name, city/state and country, elevation, optional catalog
  description, filtered flight count, visited state on My Flights, and an
  explicit Show flights from this launch action.
- Show flights from this launch retains the current pilot and time filters and
  adds the launch constraint.
- A map has one active selection: either a flight or a launch. A launch filter
  is independent of that selection. After a filter change, a selected flight
  remains selected only if it still matches.
- The address-bar URL is the Phase 2 sharing and return mechanism. It restores
  filters, viewport, layer visibility, and selection. `/personal` always shows
  the signed-in pilot's own history; it is not a public pilot-history URL.

## Data and query contract

- Add nullable `flights.launch_id` referencing the existing `launches` catalog
  and a launch-match projection version. A current projection version with a
  null launch ID means the flight was evaluated and is an Unknown launch. Do
  not use the generated Launch Arena area as the semantic matching boundary.
- Resolve a catalog launch with an indexed geography-distance query from the
  flight's launch coordinates to the catalog launch point. Order by distance,
  then catalog ID for deterministic ties, and accept only results at or below
  1,000 meters.
- Resolve Country visits independently with the Country Arena polygon covering
  the flight's launch point. Do not reuse lifetime achievement counts because
  history summaries are filter-dependent and Unknown launches must count.
- Use one validated filter value and one shared SQL predicate builder for map
  tracks, the flight list, selection validation, launch counts, and summaries.
- Evaluate Year, Month, and Custom Range against each flight's launch-local
  date. Custom Range has inclusive start and end dates. Reject incomplete,
  reversed, or invalid ranges at the HTTP boundary.
- Sum `flight_scores.five_point_distance_meters` for Distance flown and sort
  Distance by that same field. Flights without a score still count as flights;
  their missing score does not add distance.
- All endpoints remain authenticated and use private, no-store responses.

## URL contract

Use explicit, independently validated query parameters. Final names may follow
the existing naming style, but the state model must represent:

- period plus year/month or custom start/end dates;
- launch filter, including a distinct Unknown value;
- sort and global/map-area geography;
- latitude, longitude, and zoom;
- launch-layer visibility;
- either selected flight ID or selected catalog launch ID, never both.

Meaningful user actions such as changing a filter or selection should create a
browser-history entry. Map movement should replace the current entry. Reload
and Back/Forward must reconstruct the same state without relying on prior
in-memory data.

## Thin vertical slices

Each slice must leave an integrated, executable path through the affected
route, service, persistence, presentation, and browser layers. Do not build all
schema, service, or UI work in separate horizontal phases.

### 1. Dedicated My Flights destination and scope defaults

Deliver the smallest visible product boundary using the existing flight-map
endpoints.

1. Separate rendered page type from active primary-navigation identity so the
   existing map template can highlight either Map or My Flights.
2. Change primary navigation to Map, Plan, My Flights, Profile without deleting
   Activity or Achievements routes or templates.
3. Remove Personal from the Map pilot selector and remove the selector from
   `/personal`.
4. Apply the three confirmed initial period/sort defaults. Preserve explicit
   selections when switching between Following and All Pilots.
5. Add router, shell-model, renderer, and browser tests for direct navigation,
   active states, defaults, and carried selections.

Acceptance: `/personal` is visibly a first-class My Flights destination, while
`/following` and `/global` remain one Map destination with a two-option pilot
filter.

### 2. One durable flight-to-launch path

Introduce catalog identity through a complete processing and read path before
building the launch layer.

1. Add nullable `flights.launch_id`, a launch-match projection version, the
   foreign key and lookup indexes, and an indexed catalog-launch point lookup
   through an ordered Drizzle migration.
2. Add a focused launch matcher that returns the nearest catalog ID within
   1,000 meters or `null`.
3. Call the matcher during flight processing when launch coordinates are
   persisted.
4. Return the persisted catalog ID and catalog name from the flight-map list;
   render Unknown launch when it is null.
5. Cover sub-1 km, exactly 1 km, over-1 km, overlapping candidates,
   deterministic ties, missing coordinates, and processing integration.

Acceptance: a newly processed flight shows its persisted catalog launch in the
existing flight browser, with no dynamic Arena-containment inference.

### 3. Existing-flight reconciliation

Make accumulated history complete before relying on launch filters or counts.

1. Add a bounded, rerunnable backfill that processes completed flights with
   launch coordinates and missing launch identity.
2. Use the same matcher as live processing. Persist Unknown as `NULL` with the
   current launch-match projection version so it is not repeatedly treated as
   unfinished and can still be deliberately rebuilt after a matching-rule or
   catalog change.
3. Add progress logging, failure isolation, and a release verification query
   that distinguishes matched, unmatched, and not-yet-evaluated rows.
4. Register the command in package scripts and release-backfill verification.

Acceptance: live processing and reconciliation produce identical launch
assignments and the verification command can prove reconciliation is complete.

### 4. Shared launch map layer

Deliver catalog launches on all map scopes without adding launch selection yet.

1. Add a launch-map service method and authenticated viewport endpoint that
   return minimal marker data and handle antimeridian-crossing bounds.
2. Add a dedicated MapLibre source and clustered marker layers.
3. Load and refresh launches with viewport changes without coupling them to the
   flight track/list requests.
4. Add the visible-by-default layer toggle and persist its state in the URL.
5. Test endpoint validation, viewport inclusion, antimeridian behavior,
   clustering configuration, toggle behavior, reload restoration, and request
   cancellation.

Acceptance: catalog launches appear and cluster on `/personal`, `/following`,
and `/global`, and can be hidden/restored without changing the visible flights.

### 5. Launch selection and information

Add the smallest useful interaction with a launch marker while preserving the
map results.

1. Add a launch-detail service method and authenticated endpoint for the
   confirmed catalog fields and a flight count under the active scope/time
   filters.
2. Add a reusable launch-information panel suitable for desktop and the mobile
   map sheet.
3. Selecting a launch opens the panel, writes the launch selection to the URL,
   and does not refresh or filter tracks or the list.
4. Restore a selected launch on reload and Back/Forward. Selecting a flight
   replaces it, and selecting a launch replaces a flight.
5. Test authorization, missing launches, optional description, visited state,
   single-selection behavior, and the no-implicit-filter invariant.

Acceptance: a copied or reloaded map URL reopens the same launch information
without changing the flight result set.

### 6. Launch filtering end to end

Turn the explicit launch action into one observable filter path.

1. Extend the shared filter parser and service predicate with a catalog launch
   ID or Unknown launch.
2. Propagate the predicate through viewport tracks, global/map-area lists,
   pagination cursors, launch-detail counts, and selection validation.
3. On My Flights, load the filter choices from the pilot's distinct visited
   launches under the active non-launch filters and append Unknown when at
   least one otherwise-matching flight is unknown. Exclude the launch predicate
   itself while building these faceted options.
4. Wire Show flights from this launch to retain pilot/time selections and add
   the launch filter. Do not make marker selection invoke this action.
5. Preserve the filter in the URL and across Following/All Pilots scope changes.
6. Test visited-option eligibility, Unknown, empty results, cursor stability,
   map-area interaction, explicit-action behavior, and URL restoration.

Acceptance: the explicit action filters the visible tracks and list to the
selected launch while a normal marker click never does.

### 7. Personal time modes

Complete the My Flights history periods without changing the established
launch-local semantics.

1. Replace the My Flights time choices with All Time, Year, Month, and Custom
   Range while leaving the shared Map behavior compatible with its current
   period URLs.
2. Extend the router and shared service filter with inclusive custom start/end
   dates and exact launch-local predicates.
3. Add accessible Year, Month, and Custom Range controls with clear invalid and
   empty states.
4. Persist and restore every mode in the URL. Changing modes removes stale
   parameters from the previous mode.
5. Test UTC-12/UTC+14 boundaries, leap days, month/year edges, inclusive custom
   endpoints, invalid/reversed ranges, and URL canonicalization.

Acceptance: the same period selects the same flights in tracks, lists, launch
counts, and a direct reloaded URL.

### 8. Filtered personal summaries

Add summaries through one endpoint, growing the result incrementally while
reusing the exact visible-flight predicate.

1. First return Total flights for the active personal filter and render the
   five-summary shell with stable loading/error/zero states.
2. Add summed five-point Distance flown and Airtime.
3. Add distinct matched catalog Launches visited.
4. Add distinct Countries visited by spatially covering every matching flight's
   launch point with Country Arenas, independently of `launch_id`.
5. Refresh summaries on every time, launch, geography, or map-area change;
   debounce viewport-driven requests and cancel stale responses.
6. Test each metric independently, null scores/durations/coordinates, Unknown
   launch country contribution, country-boundary behavior, all filters, and
   zero-result slices.

Acceptance: every summary describes exactly the same filtered personal flight
set as the visible history controls.

### 9. Complete URL-backed flight selection

Finish reliable return behavior for selections that are not present on the
first list page.

1. Add a filtered single-flight lookup to the flight-map service and an
   authenticated endpoint that enforces the current scope and filters.
2. Restore a selected flight from the URL, add its card when necessary, fit it
   only when restoration requires it, and retain the existing replay behavior.
3. After any filter change, revalidate the selection. Keep it when eligible and
   remove only the selection parameter when it is no longer eligible.
4. Implement `popstate` restoration for filters, viewport, layer visibility,
   launch selection, and flight selection.
5. Test off-page selection restoration, unauthorized/ineligible IDs, filter
   retention/clearing, single-selection precedence, reload, and Back/Forward.

Acceptance: address-bar state alone reproduces the map context, and eligible
selected flights survive filter changes without being forced onto the first
page of results.

### 10. Responsive, accessibility, and failure-state hardening

Polish only after every behavior has a complete vertical path.

1. Verify keyboard operation and focus restoration for scope, time, launch,
   geography, sort, layer toggle, markers, launch panel, flight cards, and
   replay controls.
2. Ensure loading, empty, truncated, invalid-URL, network-error, and stale
   selection states are distinct and non-destructive.
3. Verify desktop, 390 px, and 320 px layouts, including mobile sheet stacking,
   navigation, launch clusters, open launch information, summaries, long names,
   custom dates, and replay controls.
4. Confirm there are no horizontal overflows, obscured controls, focus traps,
   or browser-console errors.

Acceptance: all three map contexts remain operable with mouse, touch, and
keyboard at supported widths.

## Likely implementation locations

- `src/db/schema.ts` and an ordered `drizzle/` migration for launch identity and
  indexes.
- `src/services/flightProcessingService.ts` plus a focused launch-matching
  service for live assignment.
- `src/scripts/` and `src/scripts/verifyReleaseBackfills.ts` for reconciliation.
- `src/services/flightMapService.ts` for the shared filter, tracks, lists,
  selection validation, and summaries unless a focused personal-history or
  launch-map service produces a clearer ownership boundary.
- `src/web/webRouter.ts` for strict query validation and authenticated delivery.
- `src/views/authenticated/adapters/shellModel.ts`, map models, reusable
  components, and the map page template for navigation and presentation.
- `public/scripts/app-ui/mapFlightBrowser.js` and small focused map modules for
  URL state, launch layers, launch panels, and summary coordination.
- `public/styles/app-ui/map.css` for responsive map/history presentation.

Follow existing ownership boundaries instead of forcing all behavior into the
listed files. Extract a new service or browser module when it has a distinct
responsibility and focused tests; do not create placeholder layers.

## Verification gates

After each slice:

- Run its focused unit tests and any affected integration tests.
- Run `npm run typecheck`.
- Run `git diff --check`.
- Apply schema changes with `npm run db:migrate`; never use `db:push`.

At the Phase 2 boundary:

- Run the complete affected map, launch, flight-processing, router, renderer,
  and browser-controller test set.
- Run `npm run build`.
- Run the launch reconciliation and release-backfill verification against the
  intended environment.
- Perform authenticated browser QA on `/personal`, `/following`, and `/global`
  with direct URLs, reload, Back/Forward, all filter modes, both selections,
  layer toggling, and empty/error states.
- Perform a dedicated code-review pass, resolve actionable findings, and rerun
  every affected gate.
- Update documentation to reflect changes.
- Perform a check on test to eliminate UI and style tests and code that is now unused.
- Perform a final regression check.

## Deferred and excluded

- Exploration/history coverage overlay.
- Cell or territory overlay work.
- Public or other-pilot personal-history maps.
- Seasons and regional summaries.
- Product analytics or a Copy link control.
- Removing Activity or Achievements routes, templates, or services.
- Redefining distance away from five-point distance.
