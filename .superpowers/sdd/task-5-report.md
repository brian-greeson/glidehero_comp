# Task 5 report: Vento main page and HTTP-only cookie forms

## Status

Implemented the GlideHero browser authentication surface and composed it into the real server runtime on `codex/glidehero-auth`.

The web flow now:

- renders the anonymous login/signup page and authenticated account/logout state through Vento;
- reads the configured browser-session cookie before routing and resolves the current user through `AuthService`;
- handles signup, login, and logout as URL-encoded browser forms;
- returns 303 redirects after successful signup, login, and logout;
- uses `HttpOnly`, `SameSite=Lax`, `Path=/`, and a seven-day default `Max-Age`, with `Secure` enabled in production;
- revokes the submitted session token before clearing the logout cookie;
- returns generic login and duplicate-account errors without rendering submitted passwords; and
- serves the focused responsive stylesheet from `/styles/app.css`.

## TDD evidence

### RED

Created the cookie, HTTP router, and real Vento renderer tests before their production modules existed, then ran:

```bash
npx vitest run test/unit/sessionCookie.test.ts test/unit/webRouter.test.ts test/unit/renderer.test.ts
```

Relevant output:

```text
FAIL  test/unit/renderer.test.ts
Error: Cannot find module '../../src/views/renderer.js'

FAIL  test/unit/sessionCookie.test.ts
Error: Cannot find module '../../src/web/sessionCookie.js'

FAIL  test/unit/webRouter.test.ts
Error: Cannot find module '../../src/web/currentUserMiddleware.js'

Test Files  3 failed (3)
Tests       no tests
```

This was the expected RED: the tests could not import the missing Task 5 browser modules.

### GREEN and environment diagnosis

After implementing only the specified browser modules, Vento templates, static styling, and runtime composition, the first focused run inside the sandbox timed out. Isolating the suites showed that cookie serialization and real Vento compilation both passed, while every HTTP test reported:

```text
Error: listen EPERM: operation not permitted 127.0.0.1
```

The failure was the sandbox denying loopback binding, not an application defect. Rerunning the same focused tests with loopback permission produced:

```text
Test Files  3 passed (3)
Tests       12 passed (12)
```

That run exercised real cookie encoding/decoding and attributes, real Express middleware/router behavior over HTTP, and actual Vento template compilation and rendering.

### Full verification

Ran the brief's complete verification command with loopback permission:

```bash
npm test && npm run typecheck && npm run build
```

Output:

```text
Test Files  6 passed (6)
Tests       23 passed (23)

> glidehero@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit

> glidehero@0.1.0 build
> tsc -p tsconfig.json
```

The combined command exited 0.

## Files changed

- Added `src/web/sessionCookie.ts`: named session-cookie parsing, protected serialization, and clearing.
- Added `src/web/currentUserMiddleware.ts`: cookie-to-current-user resolution and typed Express locals.
- Added `src/web/webRouter.ts`: GET page plus signup, login, and logout form endpoints.
- Added `src/views/renderer.ts`: strict, autoescaped Vento renderer and page model.
- Replaced `src/views/layouts/appLayout.vto`: GlideHero document layout and stylesheet link.
- Replaced `src/views/pages/index.vto`: exact anonymous and authenticated page states.
- Added `public/styles/app.css`: responsive light/dark page styling.
- Updated `src/app.ts`: public static-file serving before browser middleware.
- Updated `src/index.ts`: real database, authentication, cookie, renderer, middleware, and router composition.
- Added `test/unit/sessionCookie.test.ts`: real cookie attribute, production `Secure`, read, and encoding coverage.
- Added `test/unit/webRouter.test.ts`: real HTTP middleware/router coverage with an isolated `AuthService` double.
- Added `test/unit/renderer.test.ts`: real Vento compilation, anonymous/authenticated state, and autoescape coverage.
- Added `.superpowers/sdd/task-5-report.md`: Task 5 TDD, verification, and review record.

## Self-review

- Compared every file and exported interface against `.superpowers/sdd/task-5-brief.md`.
- Confirmed the anonymous renderer output contains login and signup forms but no logout form.
- Confirmed the authenticated renderer output contains display name, email, and logout form but no login or signup form.
- Confirmed Vento runs with strict variables and autoescaping, and a renderer test proves user-controlled display input is escaped.
- Confirmed neither error path includes a password in its page model or resulting HTTP response.
- Confirmed signup and login set the opaque token through the real `SessionCookie` implementation and use 303 redirects to `/`.
- Confirmed logout passes the cookie token to `AuthService.logout`, emits the protected clearing cookie, and uses a 303 redirect.
- Confirmed the cookie has `Path=/`, `HttpOnly`, `SameSite=Lax`, the configured seven-day default lifetime, and production-only `Secure`.
- Confirmed the visible product name is exactly `GlideHero` and the named legacy identifiers are absent case-insensitively from application, public, and test files.
- Confirmed no migration workflow or deferred subsystem was introduced.
- Confirmed `git diff --check` reports no whitespace errors and the worktree contains only Task 5 changes.

## Concerns

None. HTTP tests must run with loopback permission in this environment because the default sandbox rejects local server binding with `EPERM`.
