# Flight upload deployment

The web service and `flight-worker` component both require `VALKEY_URL`, the
configured private Space, `BUCKET_FOLDER`, and `MAPTILER_CREDENTIALS`. The web
service uses Spaces credentials to create presigned upload and thumbnail-read
URLs. The worker needs Spaces and PostgreSQL access to process queued objects
and generate flight territory thumbnails.

`MAPTILER_CREDENTIALS` is a server-only MapTiler credential used to sign static
thumbnail requests. Browser-facing map styles continue to use the separately
configured `MAPTILER_API_KEY`.

## Historical flight-progress backfill

Before a production backfill, pause and drain the flight workers so no new flight claims or progression evaluations race the historical order. Deploy the schema and application code, then run the default dry-run:

```sh
npm run backfill:flight-progress
```

Review the reported counts, including the number of completed flights replayed with recorded `processedAt` order and the number of legacy flights replayed in approximate `createdAt` order. The dry-run and apply commands use the same ordering inventory, so the dry-run exposes the full scope before `--apply`. A warning is printed whenever legacy flights are present. For flights created before processing timestamps were recorded, exact processing completion order cannot be reconstructed when flights were processed concurrently; the backfill uses deterministic `createdAt`/ID ordering as an approximation.

Run the mutating command only with explicit authorization:

```sh
npm run backfill:flight-progress -- --apply
```

The flight-progress command is rerunnable: completed flights that already have
`flight_progress` are skipped, and achievement keys are unique per user.

## User achievement progress projection backfill

The `user_achievement_progress` table is a current, rebuildable read
projection used by the dashboard and Achievements page. The migration creates
the table, but it does not populate projection rows for pilots who already
exist. After deploying the schema and application code, run the backfill for
existing pilots. Pause and drain the flight workers first so the projection is
not rebuilt while new claims or completed-flight evaluations are being written.

The command requires the production `DATABASE_URL` and uses the fixed
500-meter application grid. The default is a rollback-only dry-run:

```sh
npm run db:migrate
npm run backfill:user-achievement-progress
```

Review the inspected-user count, inserted/updated projection counts, failures,
and elapsed time. Apply only after reviewing the dry-run:

```sh
npm run backfill:user-achievement-progress -- --apply
```

Apply mode commits each user batch independently, with a default batch size of
10. Set `USER_ACHIEVEMENT_PROGRESS_BACKFILL_BATCH_SIZE` to another positive
integer when a different transaction size is needed. The backfill is
rerunnable and verifies that every profile has a projection row after a
successful apply. If a later batch fails, earlier committed batches remain
applied; resolve the failure and rerun the command. A dry-run reports the
scope without persisting any projections.

## Flight territory thumbnail rollout and backfill

Newly completed flights generate two private WebP previews after database and
queue completion: `800x450` for wider Activity/Profile layouts and `450x450`
for mobile. Generation uses the MapTiler `outdoor-v4` static basemap and is
best-effort, so a MapTiler or object-storage failure does not fail a completed
flight. Admin claim reprocessing regenerates the pair; flight deletion removes
both objects. Activity and Profile deliver the private images with 24-hour
presigned GET URLs and use the standard fallback when either image is absent.

After deploying the web and worker code together, inspect historical completed
flights with the default missing-only dry-run:

```sh
npm run backfill:flight-thumbnails
```

The command traverses every completed flight with UUID keyset pagination and
processes flights sequentially in batches of 10. It issues read-only HEAD
requests for both deterministic keys and reports inspected, would-generate,
generated, skipped-present, and failed totals. Change the page size with a
positive `--batch-size` value:

```sh
npm run backfill:flight-thumbnails -- --dry-run --batch-size 25
```

After reviewing the dry-run, explicitly apply missing thumbnail generation:

```sh
npm run backfill:flight-thumbnails -- --apply
```

If either variant is missing, apply regenerates the pair. Use `--force` only
when every completed flight should be regenerated, for example after changing
the renderer:

```sh
npm run backfill:flight-thumbnails -- --apply --force
```

Flights remain sequential even when the batch size changes. A per-flight
failure is counted and does not stop later flights; an apply run exits nonzero
after completing the inventory if failures occurred. The command does not
change PostgreSQL. Avoid concurrent admin reprocessing during a force run so
the final object consistently comes from one renderer invocation.

## Release 2 Arena catalog and achievement rollout

Release 2 has a deliberate, one-time operational sequence. Deploy the
application and run the checked-in Drizzle migrations first. Then pause and
drain the flight workers so no live claim or achievement evaluation races the
catalog rebuild or historical replay. Run the Arena rebuild dry-run, review its
exact Country/State/Launch counts, then run the destructive apply command with
its explicit confirmation. The rebuild deletes every existing Arena row,
including General Arenas; it does not preserve rows or track changes and must
not be rerun after a successful apply:

```sh
npm run db:migrate
npm run rebuild:arenas
npm run rebuild:arenas -- --apply --confirm-delete-all-arenas
```

After the rebuild succeeds, run the Arena achievement backfill dry-run. It
executes the real award path in one rollback-only transaction per user:

```sh
npm run backfill:arena-achievements
```

Review the per-user and per-flight-batch progress messages, per-key counts,
launch-tag record events, unchanged/already-earned count, and failures. Apply
only after reviewing the output:

```sh
npm run backfill:arena-achievements -- --apply
```

Apply commits up to 100 flights per transaction by default. Set
`ARENA_ACHIEVEMENT_BACKFILL_BATCH_SIZE` to a smaller positive integer when a
shorter transaction is needed. The replay orders each user's completed flights by `started_at`, then
`created_at`, then flight UUID. Each flight sees only claims from that user's
flights at or before its position, and awards use the source flight's
historical time. Before processing a user, the command spatially maps that
user's historical claims and flight origins to Arenas once, then replays those
memberships in memory instead of repeating the spatial joins for every flight.
The existing per-user `pg_advisory_xact_lock` is reacquired for
each batch transaction. The lock serializes callers
that use the same progression lock, while pausing/draining workers remains the
operational guard against new flights entering during the one-time run. Existing ordinary Release 2
awards are left permanent and idempotent. An existing
`most_launches_tagged_one_flight` record or its events is rejected as ambiguous
rather than silently fabricating missing record history; resolve that record
before running the one-time apply.

After successful verification, restart the flight workers. The Arena
achievement command is deliberately one-time; do not rerun it after a
successful apply. A run with an existing launch-tag record is rejected as
ambiguous. Preflight failures occur before any flight batch commits, but a later
apply failure leaves earlier successful batches committed and exits nonzero.
Resolve or restore that partial state before retrying; the one-time backfill does
not automatically resume it.

## Release 3 Arena leadership and claim-timestamp backfill

Deploy the checked-in migrations and application code, then pause and drain the
flight workers. During this one-time run, avoid Arena edits and admin claim
mutations. `DATABASE_URL` is the only required environment variable; the command
uses the fixed 500-meter application grid. The optional
`ARENA_LEADERSHIP_BACKFILL_BATCH_SIZE` controls independent batch transactions
and defaults to 10. Run the rollback-only dry-run first:

```sh
npm run db:migrate
npm run backfill:arena-leadership
```

Review the timestamp-correction and per-Arena-batch elapsed timings, inspected
and changed counts, leadership totals, and achievement totals. The backfill
corrects Competition claim timestamps from track-point order before rebuilding
leadership. It recalculates `claimable_cell_count` only for General Arenas; State
and Country Arenas are exclusive ownership scopes with no denominator work.

After review, run the independent-commit apply:

```sh
npm run backfill:arena-leadership -- --apply
```

Verify the summary and database counts, including corrected timestamps,
General-Arena denominators, leadership projections/events, and idempotent
achievements. If apply fails after a committed batch, earlier batches remain
applied; resolve that partial state before retrying. Restart the flight workers
only after verification.

## Release 4 activity publication rollout

Release 4 publishes one Activity row for each newly completed flight in the
same transaction as flight completion. It intentionally performs no historical
activity backfill, so flights completed before the Release 4 code is deployed do
not gain Activity cards. Reprocessing an existing flight does not republish it;
deleting a flight cascades to its activity and Thermals.

Roll out the web and worker processes in this order:

1. Drain or pause the flight workers.
2. Apply the checked-in schema migrations with `npm run db:migrate`.
3. Deploy the Release 4 web and worker code together.
4. Resume flight processing.

The pause prevents a mixed-version worker from completing a flight while the
new `activities` table exists but the worker still lacks transactional activity
publication. Without this ordering, that old worker could complete a flight
without creating its Activity row. No activity backfill is required or
provided; only flights completed by the Release 4 worker are published.

Configure the private DigitalOcean Space with a CORS rule that allows:

- Origin: `https://glidehero.com`
- Method: `PUT`
- Request header: `Content-Type`

Uploads must use the Space origin configured by `BUCKET_URL`, not its CDN endpoint. Keep the bucket and uploaded objects private; browser access is granted only through short-lived presigned `PutObject` URLs.

The application credentials also need permission to list the configured
`BUCKET_FOLDER/uploads/<user-id>/` prefix and perform `GetObject`, `PutObject`,
`HeadObject`, and `DeleteObject`. The thumbnail backfill uses HEAD plus PUT; the
worker uses GET, PUT, and DELETE; the web process signs private GETs. Admin user
cleanup lists the prefix so orphaned IGC and thumbnail objects can still be
removed when database or queue metadata is incomplete.

The App Platform worker starts with one instance. Increase `workers[].instance_count` manually when the admin queue summary shows sustained queue growth.

## Release backfill spot checks

After running the release backfills, run the read-only verifier:

```sh
npm run verify:release-backfills
```

It checks flight progress, flight thumbnails, Arena achievements, Arena
leadership, and user achievement progress. Each check samples at most two of
the oldest eligible records. `PASS` means every sampled record has its expected
database row or thumbnail pair, `FAIL` means a sampled artifact is missing, and
`SKIP` means the database has no eligible record for that check. `ERROR` means
the database or object-store check could not be performed. Failures and errors
exit nonzero. This is deliberately evidence that a backfill has run, not a
complete record-by-record audit.
