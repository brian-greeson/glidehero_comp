# IGC Flight Track Parsing Design

## Goal

Process each uploaded IGC file synchronously, retain the source object and its
processing outcome, and persist a completed flight with its ordered GPS fixes.

## Scope

- Parse valid IGC files without a third-party parsing dependency.
- Extract ordered valid GPS fixes, UTC timestamps, launch location, duration,
  and cumulative flight distance.
- Store flights and track points with the required user, flight, and point
  relationships.
- Fetch the stored file from S3 for processing after upload.
- Render a concise success message or an actionable processing failure.

The first version is synchronous. A batch worker is deliberately out of scope,
but the processing boundary must make a later worker possible without moving
parsing logic into the web route.

## Architecture

The existing upload service remains the route's single entry point. It stores
the object in S3 and writes the `igc_files` record, creates a `flights` record
in `processing` state, then delegates to a flight-processing service.

The flight-processing service reads the source object back from S3 with
`GetObject`, converts its body to text, calls a pure parser, and persists a
successful result in one database transaction. The transaction inserts all
track points and changes the flight to `completed` with its derived summary.

If object retrieval or parsing fails, the service retains the object,
`igc_files` record, and `flights` record. It changes the flight to `failed`,
stores a safe user-facing error message, and returns a typed failure result to
the web route. Database and other infrastructure failures retain the existing
500 response and are logged without exposing implementation details.

## Module Boundaries

- `src/domain/igc/*`: pure types, parser errors, fixed-width IGC record
  decoding, timestamp assembly, and distance calculation. These modules do not
  know about HTTP, S3, Drizzle, or Express.
- `src/services/flightProcessingService.ts`: coordinates source retrieval,
  parsing, transaction-scoped persistence, processing-state transitions, and
  the typed outcome returned to the upload service.
- `src/services/igcFileService.ts`: owns S3 upload and `igc_files` persistence,
  then invokes the processing service. It does not decode IGC text.
- `src/resources/bucketClient.ts`: provides the shared S3 client used for both
  upload and retrieval.
- `src/web/webRouter.ts` and the page renderer: map the typed processing outcome
  to the current form's success or error state only.

This separation permits a later worker to call `FlightProcessingService` with
an existing flight/source-file identity while reusing the parser and persistence
behavior unchanged.

## Database Design

`igc_files` remains the immutable source-file table. Add two tables:

### flights

- UUID primary key (`flight_id`).
- Required `user_id` foreign key to `users`, cascading on user deletion.
- Required, unique `igc_file_id` foreign key to `igc_files`, cascading on
  source-file deletion. One upload creates one processing attempt in this
  version.
- Required processing state: `processing`, `completed`, or `failed`.
- Nullable `processing_error`, populated only for a failed flight with the safe
  message returned to the user.
- Nullable completed-flight summary: start and end timestamps, duration in
  seconds, distance in metres, launch latitude, and launch longitude.
- Standard creation and update timestamps plus indexes on `user_id` and
  `igc_file_id`.

### track_points

- UUID primary key (`track_point_id`).
- Required `flight_id` foreign key to `flights`, cascading on flight deletion.
- Required zero-based `sequence_number`; unique with `flight_id` to preserve
  and efficiently retrieve source order.
- Required UTC timestamp, latitude, longitude, GPS altitude in metres, and
  pressure altitude in metres.
- An index on `(flight_id, sequence_number)` for ordered flight-track reads.

Drizzle relations will expose `users.flights`, `flights.user`,
`flights.igcFile`, `flights.trackPoints`, and `trackPoints.flight`. Failed
flights validly have zero track points and no completed-flight summary.

## Parser Contract

The parser accepts LF or CRLF lines and requires:

- an IGC `A` manufacturer record;
- an `HFDTE` date header; and
- at least two valid `B` GPS-fix records.

It decodes the standard fixed-width `B` fields, retaining only fixes whose
validity flag marks them valid. Each retained point contains the source-order
sequence, latitude, longitude, pressure altitude, GPS altitude, and a UTC
timestamp formed from the header date and fix time. When times cross midnight,
the parser advances the date so the resulting timestamps remain in source
order. Flight launch location is the first retained point. Duration is the
difference between first and last retained timestamps. Distance is the sum of
great-circle (Haversine) segments in metres.

The parser rejects malformed or out-of-range time, coordinate, or altitude
fields; missing or invalid required headers; unusable dates; no retained valid
fixes; and files with fewer than two retained valid fixes. It returns stable
internal error codes, including `missing_date`, `invalid_fix`, and
`insufficient_fixes`, which the processing service maps to concise user-safe
messages.

## User Experience and Failure Handling

On success, the upload redirects to the existing page and displays only “IGC
flight processed successfully.” It does not yet display flight statistics.

On parsing failure, the upload response renders the form with an actionable
message, such as “This IGC file has no valid GPS fixes to process.” The source
object and the failed flight remain available for future diagnosis and retry.
S3 read failures use a non-sensitive retry message. The interface does not
surface raw parser exceptions, bucket keys, stack traces, or database errors.

## Verification

Unit tests will cover the pure parser's fixed-width decoding, valid coordinate
and altitude extraction, timestamp construction, midnight rollover, source
order, launch location, duration, Haversine distance tolerance, and every
defined parsing failure.

Service tests will cover S3 object-body reading, successful transaction
persistence, and retained failed-flight updates with no track points. Schema
integration tests will verify tables, non-null fields, foreign keys, unique
sequence constraints, indexes, and Drizzle relations. Router tests will verify
the success copy and a rendered parsing failure. The implementation will run
the unit suite, integration suite with `TEST_DATABASE_URL`, typecheck, and
production build.
