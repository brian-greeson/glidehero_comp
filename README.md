# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, and PostgreSQL web application.
The first milestone provides server-rendered email/password signup and login using
revocable HTTP-only cookie sessions.

## Requirements

- Node.js 25.9.0 (`.nvmrc` and `mise.toml` are provided)
- PostgreSQL with permission to create tables in the target database

## Local setup

```bash
npm install
createdb glidehero
cp .env.example .env
npm run db:push -- --force
npm run dev
```

Open <http://localhost:3000>. Create an account, log out, and log back in.
The process health endpoint is <http://localhost:3000/v1/up>.

## Validation

Create a separate disposable test database, then run:

```bash
createdb glidehero_test
npm test
TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration
npm run typecheck
npm run build
```

Integration tests drop and recreate the `public` schema in the test database, then run
`npm run db:push -- --force` with `DATABASE_URL` set to `TEST_DATABASE_URL`.
Never point `TEST_DATABASE_URL` at development or production data.

## Production notes

Set `ENVIRONMENT=production` so the session cookie receives the `Secure`
attribute. Terminate HTTPS before traffic reaches the application, run
`npm run db:push -- --force` to synchronize the target database before starting a
new release, and provide `DATABASE_URL` through the deployment secret store.
