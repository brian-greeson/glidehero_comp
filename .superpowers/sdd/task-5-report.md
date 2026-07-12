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

## Review Fix

### Findings addressed

- `SessionCookie.read` called `decodeURIComponent` without guarding malformed percent encoding, so a request such as `Cookie: glidehero_session=%` raised `URIError` and returned HTTP 500.
- The invalid login and signup branches parsed `req.body` safely with Zod but then dereferenced `req.body.email` and `req.body.displayName`; unsupported or absent content types left the body undefined and caused HTTP 500.
- The initial password non-rendering assertions used a fake renderer that never emitted form values, so they could not prove the real Vento response excluded a submitted password.
- The signup validation message described only email and minimum password length even when display-name length or maximum password length was invalid.
- Static stylesheet serving had no HTTP regression protecting `/styles/app.css`, its content type, representative content, or its placement before authentication middleware.

### Review-fix RED

Added direct cookie and real HTTP regressions before editing production code, then ran with loopback permission:

```bash
npx vitest run test/unit/sessionCookie.test.ts test/unit/webRouter.test.ts --reporter=verbose
```

Relevant output:

```text
GET / 500
URIError: URI malformed

POST /login 500
TypeError: Cannot read properties of undefined (reading 'email')

POST /signup 500
TypeError: Cannot read properties of undefined (reading 'email')

Test Files  2 failed (2)
Tests       4 failed | 11 passed (15)
```

The four expected failures were the direct malformed-cookie read, malformed-cookie GET, bodyless login POST, and bodyless signup POST. The new real-Vento response and stylesheet HTTP tests passed against existing behavior and established coverage for the review's previously unproved requirements.

### Review-fix GREEN

Changed `SessionCookie.read` to return `null` when its named token cannot be decoded. Added a focused `formBody` normalizer that converts null, undefined, arrays, primitives, and other unsupported request bodies to an empty record before validation or safe-field redisplay. Replaced the incomplete signup validation text with a message covering valid email, the optional 48-character display-name maximum, and the 12-to-128-character password range.

Reran the focused command:

```text
GET / 200
GET /styles/app.css 200
POST /login 401
POST /signup 422
POST /signup 409

Test Files  2 passed (2)
Tests       15 passed (15)
```

The 409 signup case used the real `createPageRenderer()` over HTTP and verified that email and display name were safely redisplayed while the submitted password was absent from the actual Vento HTML.

### Review-fix full verification

Ran:

```bash
npm test && npm run typecheck && npm run build
```

Output:

```text
Test Files  6 passed (6)
Tests       29 passed (29)

> glidehero@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit

> glidehero@0.1.0 build
> tsc -p tsconfig.json
```

The combined command exited 0.

### Review-fix files

- Updated `src/web/sessionCookie.ts`: treats undecodable named cookies as absent.
- Updated `src/web/webRouter.ts`: normalizes unknown request bodies and uses complete signup validation copy.
- Updated `test/unit/sessionCookie.test.ts`: direct malformed-percent regression.
- Updated `test/unit/webRouter.test.ts`: malformed-cookie middleware, bodyless form, real Vento password omission/safe redisplay, and stylesheet ordering regressions.
- Updated `.superpowers/sdd/task-5-report.md`: review findings and TDD/verification evidence.

### Review-fix self-review

- Confirmed malformed percent encoding cannot escape `SessionCookie.read` and is represented to current-user middleware as no token, so `AuthService.authenticate` is not called.
- Confirmed both form handlers normalize unknown input before Zod parsing and access only the normalized record during validation redisplay.
- Confirmed bodyless login and signup requests return HTML with controlled 401 and 422 statuses rather than the JSON 500 handler.
- Confirmed the signup validation message accurately covers email, optional display-name maximum length, and both password bounds.
- Confirmed the real Vento HTTP regression forces `AuthFailure('duplicate_email')`, finds safe email/display-name values in the rendered form, and does not find the submitted password.
- Confirmed `/styles/app.css` returns 200, `text/css`, and `.auth-grid` content even with a valid session cookie, while `AuthService.authenticate` remains uncalled because static serving precedes injected browser middleware.
- Confirmed the existing 303 redirect, protected-cookie, logout revocation, anonymous/authenticated Vento, and server-core tests remain green.
- Confirmed no migration workflow, deferred subsystem, legacy identifier, or unrelated file was added.

### Review-fix concerns

None. As before, real HTTP tests require loopback permission because the default sandbox rejects local server binding.
