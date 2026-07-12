# Task 4 report: database-backed accounts and opaque browser sessions

## Status

Implemented the Task 4 authentication service and real PostgreSQL integration coverage on `codex/glidehero-auth`.

The service now:

- creates normalized accounts, password credentials, profiles, and browser sessions in one transaction;
- stores scrypt password hashes and SHA-256 digests of random 32-byte base64url session tokens;
- maps normalized-email uniqueness failures to `AuthFailure('duplicate_email')`;
- returns the same `AuthFailure('invalid_credentials')` code for unknown accounts and wrong passwords;
- updates `last_login` and creates a new opaque session on successful login;
- authenticates only unexpired token digests; and
- revokes sessions by deleting their stored digest.

## TDD evidence

### RED

The worktree is nested inside a legacy checkout. With the local service absent, Vite's `.js`-to-`.ts` fallback unexpectedly crossed out of the worktree and loaded the legacy checkout's `src/services/authService.ts` instead of reporting the planned missing-module failure. To make the RED phase exercise this worktree unambiguously, I added only the exact public Task 4 type/interface scaffold and a factory that deliberately threw `Error('Not implemented')`.

I then ran the integration suite against the user-approved disposable PostgreSQL database outside the sandbox because loopback access is restricted:

```bash
TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- authService.integration.test.ts
```

Relevant output:

```text
FAIL test/integration/authService.integration.test.ts
Test Files  1 failed | 1 passed (2)
Tests       5 failed | 2 passed (7)

Error: Not implemented
 ❯ createAuthService src/services/authService.ts:37:9
```

All five service scenarios failed at the local unimplemented factory, while both existing schema integration tests passed. This was the expected behavioral RED for normalized transactional signup, duplicate rejection, generic credential failure/login update, session resolution/revocation, and expiry rejection.

### GREEN iteration: Drizzle-wrapped unique violation

After the minimal complete service implementation, the real-database suite exposed one compatibility defect:

```text
Test Files  1 failed | 1 passed (2)
Tests       1 failed | 6 passed (7)

AssertionError: expected DrizzleQueryError ... to match object { code: 'duplicate_email' }
DrizzleQueryError {
  "cause": error {
    "code": "23505",
    "constraint": "users_email_key"
  }
}
```

The installed Drizzle release wraps PostgreSQL driver failures in `DrizzleQueryError.cause`. The existing duplicate-normalized-email integration test was the regression test. I changed only the unique-violation predicate to follow the error cause chain, preserving the generic `duplicate_email` service contract.

The focused integration rerun then passed:

```text
Test Files  2 passed (2)
Tests       7 passed (7)
```

### Final GREEN verification

Ran the brief's combined verification command outside the sandbox for PostgreSQL and loopback access:

```bash
TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- authService.integration.test.ts && npm test && npm run typecheck
```

Output:

```text
Test Files  2 passed (2)
Tests       7 passed (7)

Test Files  3 passed (3)
Tests       11 passed (11)

> glidehero@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

The combined command exited 0.

## Files changed

- Added `src/services/authService.ts`: exact Task 4 exported types, `AuthFailure`, `AuthService`, and database-backed `createAuthService` implementation.
- Added `test/integration/authService.integration.test.ts`: real PostgreSQL coverage for normalized signup, exact token digest storage, duplicate rollback safety, generic credential failures, `last_login`, session resolution/revocation, and expiry.
- Added `.superpowers/sdd/task-4-report.md`: Task 4 implementation, TDD, verification, and review record.

## Self-review

- Compared every exported type and method signature with `.superpowers/sdd/task-4-brief.md`; the service produces `AuthService`, `AuthFailure`, `AuthenticatedUser`, `BrowserSession`, and `createAuthService(database, options)` with the prescribed shapes.
- Confirmed `signup` wraps all four table writes in one `database.transaction` callback and does not expose a token before the transaction completes.
- Confirmed the raw random token is returned only to the caller; `app_sessions.token_hash` receives the lowercase hexadecimal SHA-256 digest. The integration test independently recomputes and compares that digest.
- Confirmed both unknown-email and wrong-password login paths throw the same `invalid_credentials` failure code.
- Confirmed successful login updates `users.last_login` and creates its session in one transaction.
- Confirmed authentication returns `null` for blank, unknown, revoked, or expired tokens and requires the related user profile.
- Confirmed logout is idempotent for blank or unknown tokens and deletes only by token digest.
- Confirmed Drizzle's wrapped PostgreSQL `23505` failure is translated without weakening the database uniqueness assertion.
- Confirmed `git diff --check` reports no whitespace errors and the worktree contains no unrelated modifications.

## Concerns

None. `resetAndPushTestDatabase` is intentionally destructive and remains confined to the explicitly supplied disposable `TEST_DATABASE_URL=postgres://localhost/glidehero_test` integration database.
