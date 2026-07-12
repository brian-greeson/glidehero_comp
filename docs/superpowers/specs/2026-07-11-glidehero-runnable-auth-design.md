# GlideHero Runnable Authentication Design

## Purpose

Bring the copied application skeleton to a reliable local running state with a server-rendered GlideHero landing page that supports basic email/password signup, login, signed-in display, and logout.

This stage establishes the smallest secure web foundation. It does not implement GlideHero's future product features, social graph, gameplay, realtime behavior, Apple authentication, or object storage.

## Current Repository Findings

The application is a strict TypeScript ESM project running on Node.js. Express 5 provides the HTTP server, VentoJS is installed for templating, Drizzle ORM uses PostgreSQL, Zod validates input, and `jose` provides the existing bearer-token implementation.

The repository is not currently runnable:

- `src/routes/routes.ts` imports five route modules that do not exist.
- `src/db/types.ts` imports eight schema exports that do not exist.
- Both `npm run typecheck` and `npm run build` fail on those imports.
- Vento templates exist but are not configured or mounted in Express.
- The page still says `My App` and `Hello World!`.
- Password signup does not persist a password, and login accepts any password for an existing email.
- Configuration requires Apple and object-storage values even when those services are unused.
- The repository has no tests and no local setup/run documentation.
- The tracked working tree contains no case-insensitive literal matches for the legacy product identifiers named in the task, but copied product concepts and dead references remain.

## Selected Approach

The browser-facing Vento application will use an opaque, random session token stored in an HTTP-only cookie. Only a hash of that token will be stored in PostgreSQL. Existing bearer-token endpoints may remain for future API clients, but the web page will not store JWTs in browser-accessible storage.

This is preferred over local-storage JWTs because page JavaScript cannot read the authentication credential. It is preferred over reusing the current JWT as the cookie because an opaque cookie can be revoked using the existing session table and does not expose signed claims to the browser.

## Application Boundary

The initial runnable application contains these independently understandable units:

1. **Configuration:** validates only settings needed by the selected runtime path. Database connection and cookie security settings are required; Apple and bucket settings are optional until their features are enabled.
2. **Database:** owns users, password credentials, profiles, and browser sessions. Copied schema or type references that do not serve this stage are removed.
3. **Authentication service:** normalizes email addresses, hashes and verifies passwords, creates and revokes sessions, and performs transactional signup.
4. **Web authentication middleware:** reads the session cookie, resolves the current user when valid, and leaves anonymous requests anonymous.
5. **Vento web routes:** render the main page and handle signup, login, and logout form submissions.
6. **API routes:** retain the health endpoint and any small, compiling API surface that is useful at this stage. Broken imports and dead copied routers are removed.

## Data Model

### Users

`users` stores a unique, normalized email address and account timestamps. Email is required for password accounts. A database uniqueness constraint is the final guard against duplicate signup.

### Password credentials

`user_passwords` has one row per password-authenticated user. It stores a versioned scrypt password encoding containing the algorithm, parameters, random salt, and derived key. Plaintext passwords are never logged, returned, or persisted.

Node's built-in `node:crypto` `scrypt` implementation will be used to avoid adding a native password library during this bootstrap stage. Verification derives a candidate key with the stored parameters and compares equal-length buffers with `timingSafeEqual`.

### Profiles

Signup creates one profile in the same transaction as the user and password. The display name defaults to the email's local part when no explicit display name is supplied.

### Browser sessions

The session table stores a generated UUID identifier, user identifier, SHA-256 hash of a cryptographically random token, expiry time, and creation time. The raw token is sent only in the cookie. Session lookup hashes the cookie value before querying. Logout deletes the session row and clears the cookie.

Sessions expire after seven days. Successful login updates `lastLogin`. Expired or missing sessions produce an anonymous page rather than an error.

## HTTP and Page Flow

### `GET /`

Anonymous visitors see a GlideHero heading and separate login and signup forms. Signed-in visitors see their display name and a logout form. The server renders both states with Vento; client-side JavaScript is not required.

### `POST /signup`

The route accepts URL-encoded `email`, `password`, and optional `displayName`. It validates input, creates the account transactionally, creates a browser session, sets the session cookie, and redirects to `/` using HTTP 303.

Validation or duplicate-email failures re-render the page with a generic, user-safe error and preserved non-secret form values. Password values are never re-rendered.

### `POST /login`

The route accepts URL-encoded email and password. Invalid credentials return the same generic error regardless of whether the email or password was wrong. Success creates a fresh browser session, sets the cookie, and redirects to `/` using HTTP 303.

### `POST /logout`

The route revokes the current session when present, clears the cookie using the same attributes with which it was set, and redirects to `/` using HTTP 303. It is safe to call while anonymous.

### Health check

`GET /v1/up` remains available without authentication and reports that the Node process is serving requests. Database readiness may be reported separately so a database outage is not hidden.

## Cookie and Request Security

The cookie name is GlideHero-specific and contains no legacy product name. It has `HttpOnly`, `SameSite=Lax`, `Path=/`, and a seven-day `Max-Age`. `Secure` is enabled in production and disabled for local HTTP development.

The app enables `express.urlencoded` with a small body limit for form posts. Password input has bounded length. Authentication failures do not reveal account existence. Secrets and raw credentials are excluded from logs.

`SameSite=Lax` substantially limits cross-site form submission, but it is not a general CSRF system. This stage contains only login, signup, and idempotent account logout behavior; future authenticated state-changing features must add explicit CSRF protection before shipping.

## Vento Integration and Presentation

Vento is initialized once with `src/views` as its root. Express web routes call a focused rendering adapter so route handlers do not depend on template-engine setup details.

The layout title, heading, form labels, buttons, error copy, and signed-in state use the exact product name `GlideHero`. A small local stylesheet may be served from a static public directory to make the two forms clear and usable, but visual branding beyond a clean responsive foundation is outside this stage.

Missing favicon references are removed unless actual GlideHero assets are added. The page must not request nonexistent template assets.

## Configuration and Local Startup

An `.env.example` documents non-secret local values. Local startup requires PostgreSQL, `DATABASE_URL`, JWT secrets only if bearer-token endpoints remain mounted, and a `PORT` defaulting to 3000. Apple and bucket variables are optional and validated only when their associated feature is used.

The README documents these commands and their expected order:

1. Install the Node version declared by the project.
2. Install dependencies.
3. Create a PostgreSQL database and copy `.env.example` to `.env`.
4. Apply Drizzle migrations.
5. Start the development server.
6. Open the main page and verify signup, logout, and login.

Broken package scripts that point to nonexistent seed files are removed or deferred. The package name and server log use consistent GlideHero naming.

## Migration Strategy

The Drizzle schema is corrected first, then a new migration is generated rather than editing an already-generated migration in place. The migration adds the constraints and session-token storage required by this design and removes only copied tables that are explicitly judged outside this stage.

Because this is a new application skeleton, compatibility with production data is not assumed. Nevertheless, migrations remain deterministic and can initialize a blank PostgreSQL database from scratch.

## Error Handling

Web routes convert expected validation, duplicate-account, and invalid-credential outcomes into rendered form errors. Unexpected errors flow to centralized middleware, are logged without secrets, and return a generic response.

API routes retain structured JSON errors. The error handler distinguishes HTML web requests from JSON API requests so a web form never receives a raw API error document during an expected failure.

## Testing and Verification

Vitest will cover focused pure and HTTP behavior:

- configuration accepts the minimal local environment and rejects missing required values;
- password hashes differ for the same plaintext, verify correctly, and reject incorrect passwords;
- signup creates a user, password, profile, and session without persisting plaintext;
- duplicate signup is rejected safely;
- login succeeds only with the correct password;
- session cookies have the required attributes;
- `GET /` renders anonymous and signed-in states;
- logout revokes the session and clears the cookie;
- the health endpoint remains public.

Database integration tests use a dedicated PostgreSQL test database and apply migrations before execution. Test helpers inject configuration and database dependencies where practical so unit tests do not require unrelated Apple or bucket services.

Completion requires all of the following evidence:

- `npm run typecheck` succeeds;
- the Vitest suite succeeds;
- `npm run build` succeeds;
- migrations apply cleanly to an empty PostgreSQL database;
- the built server starts with documented minimal configuration;
- real HTTP requests demonstrate signup, authenticated main page, logout, and login;
- a case-insensitive scan of tracked filenames and tracked file contents returns no match for any legacy product identifier named in the task;
- visible application metadata and copy consistently use `GlideHero`.

## Explicitly Deferred Work

- Apple sign-in and authorization-code exchange
- S3-compatible object storage
- realtime WebSocket behavior
- social follows and activity feeds
- games, swings, facilities, teams, and profile claims
- password reset, email verification, account deletion, and multi-device session management UI
- production deployment automation

Deferring these features keeps the first milestone narrowly focused on a secure, testable, runnable GlideHero web foundation.
