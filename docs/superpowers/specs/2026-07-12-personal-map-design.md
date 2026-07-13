# Personal Map Design

## Goal

Give each authenticated pilot a personal map that renders only their
accumulated claimed territory in their selected color. The map must never show
individual flight tracks or per-flight claim polygons. The aggregate is stored
as GeoJSON for a constant-time, per-pilot map read.

## Scope

- Add a persisted personal-territory projection for every pilot with detected
  flight areas.
- Rebuild that projection after every successfully processed flight.
- Expose the signed-in pilot's stored GeoJSON through an authenticated JSON
  endpoint.
- Make Personal the dashboard's active, working map mode and render only the
  aggregate on the existing MapLibre map.

Out of scope: competitive-map behavior, flight statistics, historical
territory snapshots, editing or deleting flights, territory sharing, and any
legacy-data migration or backfill. The application is pre-v1 and has no
existing production data.

## Architecture

`flight_areas` remains the normalized per-flight source of truth. A new
personal-territory service builds a pilot's derived map projection from all of
their `flight_areas` after the flight-area detection service completes.

The service uses PostGIS to collect and union the pilot's polygon claims,
extract polygonal results, normalize them to a WGS84 MultiPolygon, and convert
the result to a GeoJSON FeatureCollection. When the pilot has polygonal claims,
it upserts exactly one projection row; when no claims remain, it removes any
existing row. The map endpoint reads that row by the authenticated user's ID
and returns the stored GeoJSON unchanged; it returns an empty FeatureCollection
when no row exists.

This isolates future changes to aggregate construction from both HTTP and map
rendering. It also keeps map reads independent of the number of flights,
tracks, or individual detected polygons a pilot has accumulated.

## Data Model

Add `personal_territories`:

- `user_id`: UUID primary key and foreign key to `users`, with cascading
  deletion. There can be only one aggregate per pilot.
- `geojson`: required `jsonb` value holding the aggregate GeoJSON
  FeatureCollection. Its only feature has a MultiPolygon geometry and no
  per-flight properties.
- `updated_at`: required timestamptz for projection freshness.

Every stored, non-empty projection has this stable shape:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": []
      }
    }
  ]
}
```

For a pilot with no detected territory, no `personal_territories` row is
stored. The endpoint supplies `{ "type": "FeatureCollection", "features": [] }`
without querying individual-flight geometry. Once at least one claim exists,
the aggregate feature contains all currently claimed polygons with overlaps
removed. The table's primary-key index is the fast retrieval path; a spatial
index is not needed because this feature does not perform viewport queries.

## Projection Update Flow

1. An IGC upload creates and processes a flight as it does today.
2. `FlightAreaDetectionService.detect` replaces that flight's detected
   `flight_areas` rows.
3. On successful detection, `FlightProcessingService` asks the personal-
   territory service to refresh the flight owner's projection.
4. The refresh query joins `flight_areas` to the pilot's flights, unions every
   source polygon with PostGIS, produces a WGS84 MultiPolygon, wraps it in the
   stable FeatureCollection contract, and upserts the pilot's row. If that
   query finds no polygonal source geometry, it deletes any existing row so the
   endpoint correctly returns the empty FeatureCollection.

Rebuilding from every one of the pilot's persisted claim polygons is deliberate:
it guarantees reruns of area detection replace stale geometry rather than
double-counting or accumulating incorrect deltas. No migration or separate
backfill path is required.

## HTTP Contract and Authorization

Add `GET /v1/personal-territory` to the authenticated web router.

- With a valid session, respond `200 application/json` with the current
  pilot's stored FeatureCollection or the empty FeatureCollection contract.
- With no authenticated user, respond `401 application/json` with the
  existing safe error envelope; do not redirect and do not reveal whether any
  other pilot has territory.
- The route derives the target `user_id` exclusively from
  `res.locals.currentUser`. It has no path or query parameter that can select
  another pilot.
- The returned data contains aggregate geometry only. It contains no flight
  IDs, IGC-file metadata, track points, or individual claim polygons.

## Map Experience

For authenticated visitors, Personal becomes the active dashboard mode.
`dashboard.js` waits for the existing MapLibre map to load, fetches the
personal-territory endpoint with same-origin credentials, and creates one
GeoJSON source from the response. It adds only a fill layer and an outline
layer for that source.

The source is styled with `currentUser.territoryColor`, which is supplied on
the already-authenticated page. The map has no source or layer for tracks,
flights, or individual `flight_areas`. An empty response leaves the base map
visible without a territory layer feature; a fetch failure displays a concise
map-data error without conflating it with a MapTiler load failure.

Competitive mode and its dashboard information remain visibly unavailable and
are not implemented by this feature.

## Module Boundaries

- `src/db/schema.ts`, `src/db/relations.ts`, and `src/db/types.ts`: define the
  projection table, its user relationship, and its row types.
- `src/services/personalTerritoryService.ts`: owns aggregate construction,
  GeoJSON contract generation, projection upsert, and stored-projection reads.
  It does not know about Express or MapLibre.
- `src/services/flightProcessingService.ts`: invokes the refresh service after
  successful flight-area detection. It does not construct GeoJSON itself.
- `src/web/webRouter.ts`: authorizes and serializes the personal-territory
  endpoint using the current session user.
- `src/index.ts`: wires the new service into flight processing and the web
  router.
- `src/views/pages/index.vto` and `public/scripts/dashboard.js`: activate the
  Personal mode and configure the single aggregate MapLibre source and layers.

## Error Handling

The map endpoint represents no territory as a successful empty
FeatureCollection, not an error or `404`. An unauthenticated endpoint request
returns a safe `401` JSON response. Database errors during processing retain
the application's existing server-error behavior and must not expose SQL or
user-specific details. Client fetch or map-layer setup errors leave the base
map usable and display only safe, actionable copy.

## Verification

- Unit tests define the empty FeatureCollection and verify the aggregate
  service's typed results and processing-service invocation.
- PostGIS integration tests prove disjoint claims are retained, overlaps are
  merged, nested claims do not create holes, and each pilot receives exactly
  one stored GeoJSON projection independent of other pilots.
- Schema integration tests verify the projection table, JSONB column,
  primary-key ownership relationship, and cascade behavior.
- Router tests verify the authenticated JSON response, empty result, and `401`
  response without revealing another pilot's territory.
- Renderer/browser-script tests verify Personal is active and MapLibre is
  given only the aggregate source plus fill and outline layers colored from
  the pilot profile.
- Run `npm test`, `TEST_DATABASE_URL=... npm run test:integration`,
  `npm run typecheck`, and `npm run build` before declaring the feature ready.
