# Flight upload deployment

The web service and `flight-worker` component both require `VALKEY_URL`. The web service also needs the Spaces credentials to create presigned upload URLs; the worker needs Spaces and PostgreSQL access to process queued objects.

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

Configure the private DigitalOcean Space with a CORS rule that allows:

- Origin: `https://glidehero.com`
- Method: `PUT`
- Request header: `Content-Type`

Uploads must use the Space origin configured by `BUCKET_URL`, not its CDN endpoint. Keep the bucket and uploaded objects private; browser access is granted only through short-lived presigned `PutObject` URLs.

The application credentials also need permission to list the configured
`BUCKET_FOLDER/uploads/<user-id>/` prefix, read objects, and delete objects.
Admin user cleanup lists that prefix so orphaned IGC objects can still be
removed when database or queue metadata is incomplete.

The App Platform worker starts with one instance. Increase `workers[].instance_count` manually when the admin queue summary shows sustained queue growth.
