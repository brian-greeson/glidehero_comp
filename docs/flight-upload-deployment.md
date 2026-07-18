# Flight upload deployment

The web service and `flight-worker` component both require `VALKEY_URL`. The web service also needs the Spaces credentials to create presigned upload URLs; the worker needs Spaces and PostgreSQL access to process queued objects.

Configure the private DigitalOcean Space with a CORS rule that allows:

- Origin: `https://glidehero.com`
- Method: `PUT`
- Request header: `Content-Type`

Uploads must use the Space origin configured by `BUCKET_URL`, not its CDN endpoint. Keep the bucket and uploaded objects private; browser access is granted only through short-lived presigned `PutObject` URLs.

The App Platform worker starts with one instance. Increase `workers[].instance_count` manually when the admin queue summary shows sustained queue growth.
