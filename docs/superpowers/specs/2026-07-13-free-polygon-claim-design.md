# FreePolygonClaim design

## Goal

Preserve the existing automatic free-polygon territory system while giving it the backend name `FreePolygonClaim` and making its IGC-ingestion invocation a single, clearly commentable line. This creates a simple pattern for trying future claim variations without changing the current browser map contract.

## Scope

- Rename the existing backend claim detector and personal-territory projection under the `FreePolygonClaim` concept.
- Keep the current PostGIS algorithm, persistent data, route URL, returned GeoJSON, and browser map behavior unchanged.
- Encapsulate the current detector and projection behind a single FreePolygonClaim processing method.
- Hardcode the FreePolygonClaim invocation in the successful IGC processing flow, where it can be commented out to disable the variation.

## Non-goals

- No generic cross-variation projection abstraction.
- No claim-service registry or dependency injection for claim variations.
- No browser map, endpoint URL, or GeoJSON contract change.
- No database migration or physical table rename.

## Architecture

FreePolygonClaim is an independent backend vertical slice. It owns the current flight-loop polygon detection and the current per-pilot GeoJSON territory projection. The storage table names remain implementation details so existing data is preserved.

The existing territory endpoint continues to return the same GeoJSON response. Its backend dependency is renamed to the FreePolygonClaim projection, while the endpoint and client-side map retain their current names and behavior.

Future claim variations will each own their own backend projection and map rather than relying on a generic shared projection layer.

## Components

The FreePolygonClaim module exposes:

- a method that detects the free polygons for one committed flight using the existing PostGIS query;
- a method that refreshes and reads the existing per-pilot GeoJSON projection; and
- `process({ flightId, userId })`, which detects first and refreshes the projection second.

`flightProcessingService` imports and creates FreePolygonClaim directly. It does not accept claim modules as options. After it persists an IGC flight and its track points, it contains a labeled variation block with a standalone invocation:

```ts
// Claim variations — comment or uncomment individual lines to select them.
await freePolygonClaim.process({ flightId, userId });
```

Commenting this line disables FreePolygonClaim processing while leaving upload, parse, flight, and track-point persistence intact. Future variation calls are added as adjacent lines in the same block.

## Data flow and failure behavior

1. The IGC file is read, parsed, and persisted exactly as it is today.
2. After the persistence transaction commits, the enabled FreePolygonClaim line runs.
3. FreePolygonClaim detects flight polygons, then refreshes that pilot's GeoJSON territory projection.
4. The unchanged territory endpoint returns that GeoJSON to the unchanged browser map.

The existing failure boundary is preserved. A FreePolygonClaim error happens after the flight has been committed; it does not turn the uploaded flight into an invalid flight. Commenting out the line skips all FreePolygonClaim work.

## Testing

- Add a focused unit test for `FreePolygonClaim.process` proving detection occurs before projection refresh.
- Update the IGC processing unit test to prove the hardcoded FreePolygonClaim path runs after persistence.
- Rename and retain existing unit and PostGIS integration coverage for detection and territory projection behavior.
- Retain route and map tests to prove the externally visible GeoJSON contract has not changed.

