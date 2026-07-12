# GlideHero

GlideHero is a Node.js, Express, Vento, Drizzle, and PostgreSQL web application.
The first milestone provides server-rendered email/password signup and login using
revocable HTTP-only cookie sessions.

## V1 product overview

### Purpose

Glide Hero is a map-based app that transforms GPS flight tracks into a
territory-claiming game. Instead of rewarding only long-distance flights, Glide
Hero encourages exploration by allowing pilots to permanently build their own
map of claimed territory while participating in a lighthearted monthly
competition.

The app is designed so that pilots of all skill levels can make meaningful
progress. A series of small local flights can be just as rewarding as a single
long cross-country flight.

### Core user experience

The experience revolves around a single interactive world map.

Pilots upload IGC flight logs after flying. The app automatically analyzes each
flight and detects every enclosed area created by the flight track. No manual
selection or editing is required.

Every uploaded flight is processed automatically and becomes a permanent part
of the pilot's history.

### Personal map

The Personal Map is the pilot's permanent territory.

Every enclosed area from every uploaded flight contributes to the pilot's
claimed territory. Overlapping claims are merged so territory is only counted
once. The result is a single, continuously growing territory that represents
everywhere the pilot has successfully enclosed.

The Personal Map displays only this accumulated territory using a color selected
by the pilot. Individual flight tracks are not displayed.

Each uploaded flight reports statistics including:

- Total enclosed area created by the flight.
- New territory added to the pilot's permanent map.
- Flight time.
- Flight distance.

The primary goal of Glide Hero is to give pilots the satisfaction of watching
their personal map gradually grow over time.

### Competitive map

The Competitive Map provides a lightweight monthly competition.

Instead of permanently owning territory, pilots compete to control territory
during the current month.

Ownership is determined by the most recent flight that enclosed a given area,
based on the timestamp contained in the IGC file rather than the upload time. A
newer flight can reclaim territory previously controlled by another pilot.

The competition resets at the beginning of each month using the local time zone
of the flight's launch location.

Every pilot is displayed using a distinct map color to make ownership easy to
understand.

### Leaderboard

The leaderboard is based on the current map viewport.

As the user pans and zooms the map, the leaderboard dynamically ranks pilots by
the amount of territory they currently own within the visible portion of the
Competitive Map.

This creates local competition anywhere in the world without predefined regions
or flying sites.

### Initial version scope

Version 1 intentionally remains focused on the core gameplay.

Included features:

- User authentication.
- Upload IGC flight logs.
- Automatic flight processing.
- Personal territory map.
- Monthly competitive territory map.
- Dynamic viewport-based leaderboard.
- Flight statistics after upload.

Excluded from Version 1:

- Public profiles.
- Social features.
- Comments or likes.
- Following other pilots.
- Flight editing or deletion.
- Historical playback.
- Support for file formats other than IGC.

### Product philosophy

Glide Hero is not intended to replace existing flight logging applications.
Instead, it introduces a new way to enjoy flying by rewarding exploration rather
than only long-distance performance.

Every flight has value. Pilots steadily build a permanent personal map while
participating in a friendly monthly competition where anyone can compete by
exploring new areas, regardless of experience level or cross-country distance.

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
