# Flight upload deployment

The web service and `flight-worker` component both require `VALKEY_URL`. The web service also needs the Spaces credentials to create presigned upload URLs; the worker needs Spaces and PostgreSQL access to process queued objects.

## Historical flight-progress backfill

Before a production backfill, pause and drain the flight workers so no new flight claims or progression evaluations race the historical order. Deploy the schema and application code, then run the default dry-run:

```sh
npm run backfill:flight-progress
```

Review the reported counts. Run the mutating command only with explicit authorization:

```sh
npm run backfill:flight-progress -- --apply
```

After successful verification, restart the flight workers. The command is rerunnable: completed flights that already have `flight_progress` are skipped, and achievement keys are unique per user.

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
