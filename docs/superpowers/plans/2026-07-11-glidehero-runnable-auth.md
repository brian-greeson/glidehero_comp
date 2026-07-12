# GlideHero Runnable Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a locally runnable GlideHero Node.js application whose Vento-rendered main page supports secure email/password signup, login, signed-in display, and logout through HTTP-only cookie sessions backed by PostgreSQL.

**Architecture:** Express 5 is the composition boundary: a small health router remains independent of persistence, while a web router receives an injected authentication service and Vento renderer. Drizzle owns the PostgreSQL users, password credentials, profiles, and opaque browser sessions; the browser receives only a random session token in an HTTP-only cookie, and PostgreSQL stores its SHA-256 digest.

**Tech Stack:** Node.js 25.9.0, strict TypeScript ESM, Express 5, VentoJS 2.4, Drizzle ORM/Kit, PostgreSQL, Zod 4, Vitest 4, Node `crypto.scrypt`.

## Global Constraints

- The exact visible product name is `GlideHero`.
- No tracked filename or tracked file content may contain any legacy product identifier named in the task.
- The main browser page is server-rendered with Vento; client-side JavaScript is not required.
- Browser authentication uses an opaque HTTP-only cookie with `SameSite=Lax`, `Path=/`, a seven-day lifetime, and `Secure` in production.
- PostgreSQL stores only the SHA-256 digest of a browser session token and a versioned scrypt password encoding; it never stores plaintext credentials.
- Apple sign-in, object storage, realtime sockets, feeds, follows, games, swings, facilities, teams, and profile claims are outside this milestone.
- Migrations must initialize a blank PostgreSQL database deterministically.
- Every task finishes with its focused tests, `npm run typecheck`, and a commit.

## File Structure

### Retained and focused

- `src/config.ts`: parse the minimal runtime environment.
- `src/app.ts`: compose Express middleware and injected routers.
- `src/index.ts`: production composition root and HTTP listener.
- `src/db/schema.ts`: four-table authentication schema.
- `src/db/relations.ts`: only relations among those four tables.
- `src/db/client.ts`: construct and expose a typed Drizzle/PostgreSQL connection.
- `src/db/types.ts`: inferred row and insert types for the four tables.
- `src/domain/errors.ts`: small application error vocabulary.
- `src/middleware/logMiddleware.ts`: metadata-only request logging.
- `src/routes/healthRouter.ts`: public process health endpoint.
- `src/services/passwordService.ts`: scrypt encoding and verification.
- `src/services/authService.ts`: transactional account and session behavior.
- `src/web/sessionCookie.ts`: cookie parsing and serialization.
- `src/web/currentUserMiddleware.ts`: optional browser-session resolution.
- `src/web/webRouter.ts`: main-page and form handlers.
- `src/views/renderer.ts`: Vento adapter.
- `src/views/layouts/appLayout.vto`: GlideHero HTML shell.
- `src/views/pages/index.vto`: anonymous and signed-in page states.
- `public/styles/app.css`: responsive form presentation.

### Removed copied skeleton modules

Delete the profile/follow models and DTOs, copied serializers and validators, Apple/JWT API router, bucket and realtime stubs, and destructive database-reset script. They are unused by this milestone and are the source of the current compile failures and copied product concepts.

---

### Task 1: Reduce the skeleton to a compiling GlideHero server core

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `drizzle.config.ts`
- Delete: `drizzle.production.config.ts`
- Modify: `src/config.ts`
- Modify: `src/app.ts`
- Modify: `src/index.ts`
- Modify: `src/domain/errors.ts`
- Modify: `src/middleware/logMiddleware.ts`
- Create: `src/routes/healthRouter.ts`
- Create: `test/unit/config.test.ts`
- Create: `test/unit/app.test.ts`
- Create: `test/support/http.ts`
- Delete: `src/db/followModel.ts`
- Delete: `src/db/client.ts`
- Delete: `src/db/relations.ts`
- Delete: `src/db/schema.ts`
- Delete: `src/db/types.ts`
- Delete: `src/db/profileModel.ts`
- Delete: `src/domain/defaults.ts`
- Delete: `src/domain/time.ts`
- Delete: `src/domain/types.ts`
- Delete: `src/dto/followsDTO.ts`
- Delete: `src/dto/profileDTO.ts`
- Delete: `src/middleware/authMiddleware.ts`
- Delete: `src/realtime/realtimeServer.ts`
- Delete: `src/resources/bucketClient.ts`
- Delete: `src/routes/authRouter.ts`
- Delete: `src/routes/profileRouter.ts`
- Delete: `src/routes/routes.ts`
- Delete: `src/routes/templateRouter.ts`
- Delete: `src/routes/toolsRouter.ts`
- Delete: `src/scripts/migrate.ts`
- Delete: `src/scripts/resetDatabase.ts`
- Delete: `src/serializers/followsSerializers.ts`
- Delete: `src/serializers/profileSerializer.ts`
- Delete: `src/serializers/templateSerilizer.ts`
- Delete: `src/serializers/userSerializer.ts`
- Delete: `src/services/profileService.ts`
- Delete: `src/services/authService.ts`
- Delete: `src/utils/general.ts`
- Delete: `src/validation/authValidators.ts`
- Delete: `src/validation/geo.ts`
- Delete: `src/validation/profileValidators.ts`
- Delete: `src/validation/validation.ts`

**Interfaces:**
- Consumes: no application interfaces; this task establishes the clean baseline.
- Produces: `parseConfig(env): AppConfig`, `healthRouter`, `AppError`, `requestLogger`, and `createApp(dependencies?: AppDependencies): Express`.

- [ ] **Step 1: Write failing configuration and health tests**

Create `test/unit/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  it('accepts the minimal local environment', () => {
    expect(parseConfig({ DATABASE_URL: 'postgres://localhost/glidehero' })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      environment: 'development',
      isProduction: false,
      port: 3000,
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
    });
  });

  it('requires a database URL', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('enables secure production behavior', () => {
    expect(
      parseConfig({ DATABASE_URL: 'postgres://db/glidehero', ENVIRONMENT: 'production' }),
    ).toMatchObject({ environment: 'production', isProduction: true });
  });
});
```

Create `test/support/http.ts`:

```ts
import { createServer } from 'node:http';
import type { Express } from 'express';

export async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP.');

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
```

Create `test/unit/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { withServer } from '../support/http.js';

describe('server core', () => {
  it('serves a public health response', async () => {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/up`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, app: 'GlideHero' });
    });
  });

  it('does not expose the Express signature header', async () => {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/up`);
      expect(response.headers.get('x-powered-by')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm the copied skeleton fails them**

Run: `npx vitest run test/unit/config.test.ts test/unit/app.test.ts`

Expected: FAIL because `parseConfig` still requires unrelated settings and `createApp` imports missing copied routers.

- [ ] **Step 3: Replace configuration with the minimal exact contract**

Replace `src/config.ts` with:

```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default('glidehero_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
});

export type AppConfig = {
  databaseUrl: string;
  environment: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  sessionCookieName: string;
  sessionTtlSeconds: number;
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.ENVIRONMENT,
    isProduction: parsed.ENVIRONMENT === 'production',
    port: parsed.PORT,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
  };
}
```

- [ ] **Step 4: Replace the server core and safe error/logging behavior**

Replace `src/domain/errors.ts` with:

```ts
export type AppErrorCode = 'invalid_request' | 'unauthorized' | 'conflict' | 'server_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
  }
}
```

Replace `src/middleware/logMiddleware.ts` with:

```ts
import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    console.log(`${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
  });
  next();
}
```

Create `src/routes/healthRouter.ts`:

```ts
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/v1/up', (_req, res) => {
  res.status(200).json({ ok: true, app: 'GlideHero' });
});
```

Replace `src/app.ts` with:

```ts
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { AppError } from './domain/errors.js';
import { requestLogger } from './middleware/logMiddleware.js';
import { healthRouter } from './routes/healthRouter.js';

export type AppDependencies = {
  webMiddleware?: RequestHandler[];
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(requestLogger);
  app.use(healthRouter);
  for (const middleware of dependencies.webMiddleware ?? []) app.use(middleware);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'server_error', message: 'Internal server error.' } });
  };
  app.use(errorHandler);
  return app;
}
```

Replace `src/index.ts` with this temporary compiling entry point; Task 5 adds the web composition:

```ts
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { parseConfig } from './config.js';

const config = parseConfig(process.env);
const server = createServer(createApp());

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 5: Remove copied modules and unused dependencies**

Delete every file listed under **Delete** for this task. Replace `package.json` with:

```json
{
  "name": "glidehero",
  "version": "0.1.0",
  "description": "GlideHero web application",
  "main": "dist/src/index.js",
  "engines": { "node": "25.9.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "dev": "tsx watch --env-file=.env src/index.ts",
    "start": "node dist/src/index.js",
    "test": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "author": "Mountain Sentry",
  "license": "UNLICENSED",
  "private": true,
  "type": "module",
  "dependencies": {
    "drizzle-orm": "^1.0.0-rc.4-5d5b77c",
    "express": "^5.2.1",
    "pg": "^8.22.0",
    "ventojs": "^2.4.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^26.1.1",
    "@types/pg": "^8.20.0",
    "drizzle-kit": "^1.0.0-rc.4-ca0f029",
    "tsx": "^4.23.0",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

Remove `src/db/followModelts` from `tsconfig.json`'s `include` array. Run `npm install` to update `package-lock.json` and prune unused packages.

Replace `vitest.config.ts` with this serial file configuration so integration files cannot concurrently reset the same test schema:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
```

Replace `drizzle.config.ts` with the single-environment configuration used by every later migration command:

```ts
import { defineConfig } from 'drizzle-kit';
import { parseConfig } from './src/config.js';

const config = parseConfig(process.env);

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './src/db/schema.ts',
  dbCredentials: { url: config.databaseUrl },
  schemaFilter: ['public'],
});
```

Delete `drizzle.production.config.ts`; selecting a deployment database is an environment concern, not a second schema configuration.

- [ ] **Step 6: Verify the compiling core**

Run: `npm test && npm run typecheck && npm run build`

Expected: all configuration and health tests PASS; TypeScript and build exit 0 with no missing-module errors.

- [ ] **Step 7: Commit the clean baseline**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts drizzle.config.ts drizzle.production.config.ts src test
git commit -m "chore: reduce GlideHero to runnable server core"
```

---

### Task 2: Add versioned scrypt password protection

**Files:**
- Create: `src/services/passwordService.ts`
- Create: `test/unit/passwordService.test.ts`

**Interfaces:**
- Consumes: Node `crypto.scrypt`, `randomBytes`, and `timingSafeEqual`.
- Produces: `hashPassword(password: string): Promise<string>` and `verifyPassword(password: string, encoded: string): Promise<boolean>`.

- [ ] **Step 1: Write the complete password behavior tests**

Create `test/unit/passwordService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/services/passwordService.js';

describe('passwordService', () => {
  it('creates salted, versioned hashes that verify', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$64\$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
  });

  it('rejects incorrect passwords and malformed encodings', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('incorrect password', encoded)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-password-encoding')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing module**

Run: `npx vitest run test/unit/passwordService.test.ts`

Expected: FAIL with `Cannot find module '../../src/services/passwordService.js'`.

- [ ] **Step 3: Implement versioned scrypt hashing**

Create `src/services/passwordService.ts`:

```ts
import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const parameters = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, parameters.keyLength)) as Buffer;

  return [
    'scrypt',
    parameters.N,
    parameters.r,
    parameters.p,
    parameters.keyLength,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, keyLength, saltText, keyText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !keyLength || !saltText || !keyText) return false;

  const expected = Buffer.from(keyText, 'base64url');
  const length = Number(keyLength);
  if (
    Number(n) !== parameters.N ||
    Number(r) !== parameters.r ||
    Number(p) !== parameters.p ||
    length !== parameters.keyLength ||
    expected.length !== length
  ) {
    return false;
  }

  try {
    const actual = (await scrypt(password, Buffer.from(saltText, 'base64url'), length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Verify password security behavior and the full unit suite**

Run: `npm test && npm run typecheck`

Expected: all unit tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit password protection**

```bash
git add src/services/passwordService.ts test/unit/passwordService.test.ts
git commit -m "feat: add secure password hashing"
```

---

### Task 3: Focus the Drizzle schema and generate the authentication migration

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/relations.ts`
- Create: `src/db/client.ts`
- Create: `src/db/types.ts`
- Create: `migrations/20260711000100_glidehero_auth_foundation/migration.sql` via Drizzle Kit generation and directory normalization
- Create: `migrations/20260711000100_glidehero_auth_foundation/snapshot.json` via Drizzle Kit generation and directory normalization
- Create: `test/integration/database.ts`
- Create: `test/integration/schema.integration.test.ts`

**Interfaces:**
- Consumes: `parseConfig(process.env).databaseUrl` and the previous initial migration.
- Produces: `createDatabase(connectionString): { db, pool }`, `Database`, and inferred row types for `users`, `userPasswords`, `profiles`, and `appSessions`.

- [ ] **Step 1: Write the migration-level schema test**

Create `test/integration/database.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.js';

export function testDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  return createDatabase(connectionString);
}

export async function resetAndMigrateTestDatabase(): Promise<ReturnType<typeof testDatabase>> {
  const database = testDatabase();
  await database.pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await database.pool.query('CREATE SCHEMA public');
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  return database;
}
```

Create `test/integration/schema.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

afterAll(async () => {
  await database.pool.end();
});

describe('authentication schema', () => {
  it('contains only the four milestone tables', async () => {
    const result = await database.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'app_sessions',
      'profiles',
      'user_passwords',
      'users',
    ]);
  });

  it('requires normalized account and credential fields', async () => {
    const result = await database.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'users' AND column_name = 'email')
           OR (table_name = 'user_passwords' AND column_name = 'password_hash')
           OR (table_name = 'app_sessions' AND column_name = 'token_hash'))
         AND is_nullable = 'NO'
       ORDER BY table_name`,
    );
    expect(result.rows).toEqual([
      { table_name: 'app_sessions', column_name: 'token_hash' },
      { table_name: 'user_passwords', column_name: 'password_hash' },
      { table_name: 'users', column_name: 'email' },
    ]);
  });
});
```

- [ ] **Step 2: Run the integration test and verify the current schema fails**

Run: `TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- schema.integration.test.ts`

Expected: FAIL because the copied table exists and required auth columns/constraints do not.

- [ ] **Step 3: Replace the schema, relations, types, and client**

Replace `src/db/schema.ts` with:

```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('user_id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  lastLogin: timestamp('last_login', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  ...timestamps,
});

export const userPasswords = pgTable('user_passwords', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    ...timestamps,
  },
  (table) => [index('profiles_user_id_idx').on(table.userId)],
);

export const appSessions = pgTable(
  'app_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('app_sessions_user_id_idx').on(table.userId),
    uniqueIndex('app_sessions_token_hash_idx').on(table.tokenHash),
  ],
);
```

Replace `src/db/relations.ts` with:

```ts
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  users: {
    password: r.one.userPasswords({ from: r.users.id, to: r.userPasswords.userId }),
    profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
    sessions: r.many.appSessions({ from: r.users.id, to: r.appSessions.userId }),
  },
  userPasswords: {
    user: r.one.users({ from: r.userPasswords.userId, to: r.users.id }),
  },
  profiles: {
    user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
  },
  appSessions: {
    user: r.one.users({ from: r.appSessions.userId, to: r.users.id }),
  },
}));
```

Replace `src/db/client.ts` with:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { relations } from './relations.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle({ client: pool, relations });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
```

Replace `src/db/types.ts` with:

```ts
import { appSessions, profiles, userPasswords, users } from './schema.js';

export type UserRow = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserPasswordRow = typeof userPasswords.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type SessionRow = typeof appSessions.$inferSelect;
```

- [ ] **Step 4: Generate and normalize the migration directory**

Run:

```bash
npm run db:generate -- --name glidehero_auth_foundation
mv migrations/$(ls -1t migrations | head -1) migrations/20260711000100_glidehero_auth_foundation
```

Inspect the generated `migration.sql`. It must express these changes without editing the earlier migration:

```sql
DROP TABLE "profile_follows" CASCADE;
ALTER TABLE "users" DROP COLUMN "apple_subject";
ALTER TABLE "users" DROP COLUMN "deleted_at";
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
ALTER TABLE "user_passwords" RENAME COLUMN "password" TO "password_hash";
ALTER TABLE "user_passwords" ALTER COLUMN "password_hash" SET NOT NULL;
ALTER TABLE "user_passwords" DROP COLUMN "deleted_at";
ALTER TABLE "profiles" DROP COLUMN "handedness";
ALTER TABLE "profiles" DROP COLUMN "avatar_url";
ALTER TABLE "profiles" DROP COLUMN "created_by_user_id";
ALTER TABLE "profiles" DROP COLUMN "claimed_at";
ALTER TABLE "profiles" DROP COLUMN "deleted_at";
ALTER TABLE "profiles" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "app_sessions" ADD COLUMN "token_hash" text;
DELETE FROM "app_sessions";
ALTER TABLE "app_sessions" ALTER COLUMN "token_hash" SET NOT NULL;
CREATE UNIQUE INDEX "app_sessions_token_hash_idx" ON "app_sessions" ("token_hash");
```

Keep Drizzle's generated statement breakpoints and generated `snapshot.json`. If Drizzle chooses an equivalent safe ordering, preserve its output.

- [ ] **Step 5: Verify blank-database migration and types**

Run: `TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- schema.integration.test.ts && npm run typecheck`

Expected: both schema tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the database foundation**

```bash
git add src/db migrations test/integration
git commit -m "feat: add GlideHero authentication schema"
```

---
### Task 4: Implement database-backed accounts and opaque sessions

**Files:**
- Create: `src/services/authService.ts`
- Create: `test/integration/authService.integration.test.ts`

**Interfaces:**
- Consumes: `Database`, the four Drizzle tables, `hashPassword`, `verifyPassword`, and `sessionTtlSeconds`.
- Produces: `AuthService`, `AuthFailure`, `AuthenticatedUser`, `BrowserSession`, and `createAuthService(database, options)`.

- [ ] **Step 1: Write end-to-end service tests against PostgreSQL**

Create `test/integration/authService.integration.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

describe('authService', () => {
  it('creates a normalized account, credential, profile, and session atomically', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const result = await auth.signup({
      email: '  Pilot@Example.com ',
      password: 'correct horse battery staple',
      displayName: 'Sky Pilot',
    });

    expect(result.user).toMatchObject({ email: 'pilot@example.com', displayName: 'Sky Pilot' });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const stored = await database.pool.query<{
      email: string;
      password_hash: string;
      token_hash: string;
    }>(
      `SELECT u.email, p.password_hash, s.token_hash
       FROM users u
       JOIN user_passwords p ON p.user_id = u.user_id
       JOIN app_sessions s ON s.user_id = u.user_id`,
    );
    expect(stored.rows[0]?.email).toBe('pilot@example.com');
    expect(stored.rows[0]?.password_hash).not.toContain('correct horse battery staple');
    expect(stored.rows[0]?.token_hash).not.toBe(result.token);
  });

  it('rejects duplicate normalized email addresses', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    await expect(
      auth.signup({ email: 'PILOT@example.com', password: 'another secure password' }),
    ).rejects.toMatchObject({ code: 'duplicate_email' });
  });

  it('authenticates only a correct password and updates last login', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    await expect(
      auth.login({ email: 'pilot@example.com', password: 'incorrect password' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      auth.login({ email: 'pilot@example.com', password: 'correct horse battery staple' }),
    ).resolves.toMatchObject({ user: { email: 'pilot@example.com' } });
  });

  it('resolves and revokes an opaque browser session', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const session = await auth.signup({
      email: 'pilot@example.com',
      password: 'correct horse battery staple',
    });
    await expect(auth.authenticate(session.token)).resolves.toMatchObject({
      email: 'pilot@example.com',
    });
    await auth.logout(session.token);
    await expect(auth.authenticate(session.token)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the service test and verify it fails for the missing service**

Run: `TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- authService.integration.test.ts`

Expected: FAIL with `Cannot find module '../../src/services/authService.js'`.

- [ ] **Step 3: Implement the complete authentication service**

Create `src/services/authService.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSessions, profiles, userPasswords, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from './passwordService.js';

export type AuthenticatedUser = {
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
};

export type BrowserSession = {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
};

export type SignupInput = { email: string; password: string; displayName?: string };
export type LoginInput = { email: string; password: string };
export type AuthFailureCode = 'duplicate_email' | 'invalid_credentials';

export class AuthFailure extends Error {
  constructor(public readonly code: AuthFailureCode) {
    super(code);
  }
}

export interface AuthService {
  signup(input: SignupInput): Promise<BrowserSession>;
  login(input: LoginInput): Promise<BrowserSession>;
  authenticate(token: string): Promise<AuthenticatedUser | null>;
  logout(token: string): Promise<void>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export function createAuthService(
  database: Database,
  options: { sessionTtlSeconds: number },
): AuthService {
  const expiresAt = () => new Date(Date.now() + options.sessionTtlSeconds * 1000);

  return {
    async signup(input) {
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(input.password);
      const token = newToken();
      const expiry = expiresAt();
      const displayName = input.displayName?.trim() || email.split('@')[0] || 'Pilot';

      try {
        return await database.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({ email }).returning();
          if (!user) throw new Error('User insert returned no row.');

          await tx.insert(userPasswords).values({ userId: user.id, passwordHash });
          const [profile] = await tx
            .insert(profiles)
            .values({ userId: user.id, displayName })
            .returning();
          if (!profile) throw new Error('Profile insert returned no row.');

          const [session] = await tx
            .insert(appSessions)
            .values({ userId: user.id, tokenHash: tokenDigest(token), expiresAt: expiry })
            .returning();
          if (!session) throw new Error('Session insert returned no row.');

          return {
            token,
            expiresAt: expiry,
            user: {
              userId: user.id,
              email: user.email,
              displayName: profile.displayName,
              sessionId: session.sessionId,
            },
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new AuthFailure('duplicate_email');
        throw error;
      }
    },

    async login(input) {
      const account = await database.query.users.findFirst({
        where: { email: normalizeEmail(input.email) },
        with: { password: true, profile: true },
      });
      if (!account?.password || !account.profile) throw new AuthFailure('invalid_credentials');
      if (!(await verifyPassword(input.password, account.password.passwordHash))) {
        throw new AuthFailure('invalid_credentials');
      }

      const token = newToken();
      const expiry = expiresAt();
      const now = new Date();
      const [session] = await database.transaction(async (tx) => {
        await tx.update(users).set({ lastLogin: now, updatedAt: now }).where(eq(users.id, account.id));
        return tx
          .insert(appSessions)
          .values({ userId: account.id, tokenHash: tokenDigest(token), expiresAt: expiry })
          .returning();
      });
      if (!session) throw new Error('Session insert returned no row.');

      return {
        token,
        expiresAt: expiry,
        user: {
          userId: account.id,
          email: account.email,
          displayName: account.profile.displayName,
          sessionId: session.sessionId,
        },
      };
    },

    async authenticate(token) {
      if (!token) return null;
      const session = await database.query.appSessions.findFirst({
        where: { tokenHash: tokenDigest(token), expiresAt: { gt: new Date() } },
        with: { user: { with: { profile: true } } },
      });
      if (!session?.user.profile) return null;
      return {
        userId: session.user.id,
        email: session.user.email,
        displayName: session.user.profile.displayName,
        sessionId: session.sessionId,
      };
    },

    async logout(token) {
      if (!token) return;
      await database.delete(appSessions).where(eq(appSessions.tokenHash, tokenDigest(token)));
    },
  };
}
```

- [ ] **Step 4: Run service and security verification**

Run: `TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- authService.integration.test.ts && npm test && npm run typecheck`

Expected: all four service tests and all unit tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit accounts and opaque sessions**

```bash
git add src/services/authService.ts test/integration/authService.integration.test.ts
git commit -m "feat: add account and browser session service"
```

---

### Task 5: Render the Vento main page and connect HTTP-only cookie forms

**Files:**
- Create: `src/web/sessionCookie.ts`
- Create: `src/web/currentUserMiddleware.ts`
- Create: `src/web/webRouter.ts`
- Create: `src/views/renderer.ts`
- Modify: `src/views/layouts/appLayout.vto`
- Modify: `src/views/pages/index.vto`
- Create: `public/styles/app.css`
- Modify: `src/app.ts`
- Modify: `src/index.ts`
- Create: `test/unit/sessionCookie.test.ts`
- Create: `test/unit/webRouter.test.ts`
- Create: `test/unit/renderer.test.ts`

**Interfaces:**
- Consumes: `AuthService`, `AuthenticatedUser`, and `AppConfig` cookie fields.
- Produces: `SessionCookie`, `createCurrentUserMiddleware`, `createWebRouter`, `PageRenderer`, `createPageRenderer`, and the four browser endpoints.

- [ ] **Step 1: Write cookie attribute tests**

Create `test/unit/sessionCookie.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/web/sessionCookie.js';

describe('sessionCookie', () => {
  it('uses HTTP-only same-site local attributes', () => {
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    expect(cookie.set('token-value')).toBe(
      'glidehero_session=token-value; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
    );
    expect(cookie.clear()).toBe(
      'glidehero_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('adds Secure in production and reads a named cookie', () => {
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: true,
      maxAgeSeconds: 604800,
    });
    expect(cookie.set('abc')).toContain('; Secure');
    expect(cookie.read('theme=dark; glidehero_session=abc; locale=en')).toBe('abc');
    expect(cookie.read(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Write complete web route behavior tests with a fake service**

Create `test/unit/webRouter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { AuthFailure, type AuthService } from '../../src/services/authService.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'pilot@example.com',
  displayName: 'Sky Pilot',
};

function dependencies() {
  const auth: AuthService = {
    signup: vi.fn(async () => ({ token: 'new-token', expiresAt: new Date(), user })),
    login: vi.fn(async () => ({ token: 'login-token', expiresAt: new Date(), user })),
    authenticate: vi.fn(async (token) => (token === 'valid-token' ? user : null)),
    logout: vi.fn(async () => undefined),
  };
  const cookie = createSessionCookie({ name: 'glidehero_session', secure: false, maxAgeSeconds: 604800 });
  const renderPage = vi.fn(async (model) =>
    `<html><body><h1>GlideHero</h1><div>${model.currentUser?.displayName ?? 'anonymous'}</div>` +
    `<div>${model.loginError ?? model.signupError ?? ''}</div></body></html>`,
  );
  const middleware = createCurrentUserMiddleware(auth, cookie);
  const router = createWebRouter({ auth, cookie, renderPage });
  return { auth, app: createApp({ webMiddleware: [middleware, router] }) };
}

describe('webRouter', () => {
  it('renders anonymous and authenticated page states', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/`);
      expect(await anonymous.text()).toContain('anonymous');
      const authenticated = await fetch(`${baseUrl}/`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(await authenticated.text()).toContain('Sky Pilot');
    });
  });

  it('signs up, sets the protected cookie, and redirects with 303', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
          displayName: 'Sky Pilot',
        }),
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.get('set-cookie')).toContain(
        'glidehero_session=new-token; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
      );
      expect(auth.signup).toHaveBeenCalledWith({
        email: 'pilot@example.com',
        password: 'correct horse battery staple',
        displayName: 'Sky Pilot',
      });
    });
  });

  it('renders a generic login error without echoing a password', async () => {
    const { app, auth } = dependencies();
    vi.mocked(auth.login).mockRejectedValueOnce(new AuthFailure('invalid_credentials'));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'never-render-this-password',
        }),
      });
      const html = await response.text();
      expect(response.status).toBe(401);
      expect(html).toContain('Email or password is incorrect.');
      expect(html).not.toContain('never-render-this-password');
    });
  });

  it('renders duplicate signup safely without echoing a password', async () => {
    const { app, auth } = dependencies();
    vi.mocked(auth.signup).mockRejectedValueOnce(new AuthFailure('duplicate_email'));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'never-render-this-password',
          displayName: 'Sky Pilot',
        }),
      });
      const html = await response.text();
      expect(response.status).toBe(409);
      expect(html).toContain('An account with that email already exists.');
      expect(html).not.toContain('never-render-this-password');
    });
  });

  it('logs out, revokes the token, clears the cookie, and redirects', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('set-cookie')).toContain('glidehero_session=; Max-Age=0');
      expect(auth.logout).toHaveBeenCalledWith('valid-token');
    });
  });
});
```

Create `test/unit/renderer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPageRenderer } from '../../src/views/renderer.js';

describe('Vento page renderer', () => {
  it('compiles and renders anonymous and authenticated page states', async () => {
    const render = createPageRenderer();
    const anonymous = await render({ currentUser: null });
    expect(anonymous).toContain('<title>GlideHero</title>');
    expect(anonymous).toContain('action="/login"');
    expect(anonymous).toContain('action="/signup"');

    const authenticated = await render({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'pilot@example.com',
        displayName: 'Sky Pilot',
      },
    });
    expect(authenticated).toContain('Sky Pilot');
    expect(authenticated).toContain('action="/logout"');
  });
});
```

- [ ] **Step 3: Run the browser tests and verify the missing web modules fail**

Run: `npx vitest run test/unit/sessionCookie.test.ts test/unit/webRouter.test.ts`

Expected: FAIL because the cookie, current-user, and web-router modules do not exist.

- [ ] **Step 4: Implement cookie serialization and current-user middleware**

Create `src/web/sessionCookie.ts`:

```ts
export type SessionCookie = {
  read(header: string | undefined): string | null;
  set(token: string): string;
  clear(): string;
};

export function createSessionCookie(options: {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}): SessionCookie {
  const attributes = `Path=/; HttpOnly; SameSite=Lax${options.secure ? '; Secure' : ''}`;
  return {
    read(header) {
      if (!header) return null;
      for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const name = part.slice(0, separator).trim();
        if (name === options.name) return decodeURIComponent(part.slice(separator + 1).trim());
      }
      return null;
    },
    set(token) {
      return `${options.name}=${encodeURIComponent(token)}; Max-Age=${options.maxAgeSeconds}; ${attributes}`;
    },
    clear() {
      return `${options.name}=; Max-Age=0; ${attributes}`;
    },
  };
}
```

Create `src/web/currentUserMiddleware.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import type { AuthService, AuthenticatedUser } from '../services/authService.js';
import type { SessionCookie } from './sessionCookie.js';

declare global {
  namespace Express {
    interface Locals {
      currentUser: AuthenticatedUser | null;
      sessionToken: string | null;
    }
  }
}

export function createCurrentUserMiddleware(auth: AuthService, cookie: SessionCookie) {
  return async function currentUser(req: Request, res: Response, next: NextFunction) {
    try {
      const token = cookie.read(req.header('cookie'));
      res.locals.sessionToken = token;
      res.locals.currentUser = token ? await auth.authenticate(token) : null;
      next();
    } catch (error) {
      next(error);
    }
  };
}
```

- [ ] **Step 5: Implement the Vento renderer and form router**

Create `src/views/renderer.ts`:

```ts
import { resolve } from 'node:path';
import vento from 'ventojs';
import type { AuthenticatedUser } from '../services/authService.js';

export type PageModel = {
  currentUser: AuthenticatedUser | null;
  loginError?: string;
  signupError?: string;
  loginEmail?: string;
  signupEmail?: string;
  signupDisplayName?: string;
};

export type PageRenderer = (model: PageModel) => Promise<string>;

export function createPageRenderer(): PageRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
  return async (model) =>
    (
      await environment.run('pages/index.vto', {
        loginError: undefined,
        signupError: undefined,
        loginEmail: '',
        signupEmail: '',
        signupDisplayName: '',
        ...model,
      })
    ).content;
}
```

Create `src/web/webRouter.ts`:

```ts
import { Router, type Response } from 'express';
import { z } from 'zod';
import { AuthFailure, type AuthService } from '../services/authService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
import type { SessionCookie } from './sessionCookie.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(12).max(128);
const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(48).optional().or(z.literal('')),
});
const loginSchema = z.object({ email, password });

async function render(res: Response, renderPage: PageRenderer, status: number, model: PageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

export function createWebRouter(dependencies: {
  auth: AuthService;
  cookie: SessionCookie;
  renderPage: PageRenderer;
}) {
  const router = Router();

  router.get('/', async (_req, res) => {
    await render(res, dependencies.renderPage, 200, { currentUser: res.locals.currentUser });
  });

  router.post('/signup', async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      await render(res, dependencies.renderPage, 422, {
        currentUser: null,
        signupError: 'Enter a valid email and a password of at least 12 characters.',
        signupEmail: typeof req.body.email === 'string' ? req.body.email : '',
        signupDisplayName: typeof req.body.displayName === 'string' ? req.body.displayName : '',
      });
      return;
    }

    try {
      const session = await dependencies.auth.signup({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.displayName || undefined,
      });
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      res.redirect(303, '/');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'duplicate_email') {
        await render(res, dependencies.renderPage, 409, {
          currentUser: null,
          signupError: 'An account with that email already exists.',
          signupEmail: parsed.data.email,
          signupDisplayName: parsed.data.displayName,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        loginError: 'Email or password is incorrect.',
        loginEmail: typeof req.body.email === 'string' ? req.body.email : '',
      });
      return;
    }
    try {
      const session = await dependencies.auth.login(parsed.data);
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      res.redirect(303, '/');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'invalid_credentials') {
        await render(res, dependencies.renderPage, 401, {
          currentUser: null,
          loginError: 'Email or password is incorrect.',
          loginEmail: parsed.data.email,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/logout', async (_req, res) => {
    if (res.locals.sessionToken) await dependencies.auth.logout(res.locals.sessionToken);
    res.setHeader('set-cookie', dependencies.cookie.clear());
    res.redirect(303, '/');
  });

  return router;
}
```

- [ ] **Step 6: Replace the Vento templates and create the stylesheet**

Replace `src/views/layouts/appLayout.vto` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href="/styles/app.css">
    <title>GlideHero</title>
  </head>
  <body>
    <main class="shell">
      {{ content }}
    </main>
  </body>
</html>
```

Replace `src/views/pages/index.vto` with:

```html
{{ layout "layouts/appLayout.vto" }}
  <header class="hero">
    <p class="eyebrow">GlideHero</p>
    <h1>Paint the sky with your friends.</h1>
  </header>

  {{ if currentUser }}
    <section class="card signed-in">
      <p>Signed in as <strong>{{ currentUser.displayName }}</strong></p>
      <p class="muted">{{ currentUser.email }}</p>
      <form method="post" action="/logout">
        <button type="submit">Log out</button>
      </form>
    </section>
  {{ else }}
    <div class="auth-grid">
      <section class="card">
        <h2>Log in</h2>
        {{ if loginError }}<p class="error" role="alert">{{ loginError }}</p>{{ /if }}
        <form method="post" action="/login">
          <label>Email<input name="email" type="email" autocomplete="email" required value="{{ loginEmail ?? '' }}"></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" minlength="12" maxlength="128" required></label>
          <button type="submit">Log in</button>
        </form>
      </section>

      <section class="card">
        <h2>Create account</h2>
        {{ if signupError }}<p class="error" role="alert">{{ signupError }}</p>{{ /if }}
        <form method="post" action="/signup">
          <label>Display name<input name="displayName" maxlength="48" autocomplete="nickname" value="{{ signupDisplayName ?? '' }}"></label>
          <label>Email<input name="email" type="email" autocomplete="email" required value="{{ signupEmail ?? '' }}"></label>
          <label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
          <button type="submit">Sign up</button>
        </form>
      </section>
    </div>
  {{ /if }}
{{ /layout }}
```

Create `public/styles/app.css`:

```css
:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #14213d; background: #eef6ff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
.shell { width: min(960px, calc(100% - 2rem)); margin: 0 auto; padding: 5rem 0; }
.hero { max-width: 42rem; margin-bottom: 2rem; }
.eyebrow { color: #1769aa; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: .25rem 0; font-size: clamp(2.5rem, 7vw, 5rem); line-height: .95; }
.auth-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
.card { padding: 1.5rem; border: 1px solid #c8d9eb; border-radius: 1rem; background: white; box-shadow: 0 1rem 3rem rgb(20 33 61 / .08); }
form, label { display: grid; gap: .5rem; }
form { gap: 1rem; }
input, button { width: 100%; padding: .8rem .9rem; border: 1px solid #a9bfd6; border-radius: .6rem; font: inherit; }
button { border-color: #1769aa; color: white; background: #1769aa; font-weight: 700; cursor: pointer; }
.error { padding: .75rem; border-radius: .5rem; color: #8a1c1c; background: #ffe9e9; }
.muted { color: #52657a; }
@media (prefers-color-scheme: dark) {
  :root { color: #eaf4ff; background: #091522; }
  .card { border-color: #29435e; background: #10263b; }
  input { color: white; background: #091522; }
}
```

- [ ] **Step 7: Compose the real web runtime**

Add this import to `src/app.ts`:

```ts
import { resolve } from 'node:path';
```

Add static-file serving immediately before the injected web middleware:

```ts
app.use(express.static(resolve('public'), { fallthrough: true }));
```

Replace `src/index.ts` with:

```ts
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createAuthService } from './services/authService.js';
import { createPageRenderer } from './views/renderer.js';
import { createCurrentUserMiddleware } from './web/currentUserMiddleware.js';
import { createSessionCookie } from './web/sessionCookie.js';
import { createWebRouter } from './web/webRouter.js';

const config = parseConfig(process.env);
const { db } = createDatabase(config.databaseUrl);
const auth = createAuthService(db, { sessionTtlSeconds: config.sessionTtlSeconds });
const cookie = createSessionCookie({
  name: config.sessionCookieName,
  secure: config.isProduction,
  maxAgeSeconds: config.sessionTtlSeconds,
});
const webMiddleware = [
  createCurrentUserMiddleware(auth, cookie),
  createWebRouter({ auth, cookie, renderPage: createPageRenderer() }),
];
const server = createServer(createApp({ webMiddleware }));

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 8: Verify web behavior, template compilation, and build output**

Run: `npm test && npm run typecheck && npm run build`

Expected: all unit tests PASS, including anonymous/authenticated rendering and cookie attributes; TypeScript and build exit 0. A Vento syntax error must fail the web test rather than being deferred to manual runtime testing.

- [ ] **Step 9: Commit the Vento cookie-session web flow**

```bash
git add src/app.ts src/index.ts src/views src/web public test/unit
git commit -m "feat: add GlideHero login and signup page"
```

---

### Task 6: Document startup and prove the complete browser flow

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`
- Modify: `README.md`
- Create: `test/integration/webFlow.integration.test.ts`

**Interfaces:**
- Consumes: the built application, `TEST_DATABASE_URL`, the migration chain, and the four web endpoints.
- Produces: a reproducible setup/run guide and authoritative end-to-end evidence for the milestone.

- [ ] **Step 1: Write the real PostgreSQL plus Vento browser-flow test**

Create `test/integration/webFlow.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuthService } from '../../src/services/authService.js';
import { createPageRenderer } from '../../src/views/renderer.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

afterAll(async () => {
  await database.pool.end();
});

describe('GlideHero browser authentication flow', () => {
  it('signs up, renders the user, logs out, and logs back in', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    const app = createApp({
      webMiddleware: [
        createCurrentUserMiddleware(auth, cookie),
        createWebRouter({ auth, cookie, renderPage: createPageRenderer() }),
      ],
    });

    await withServer(app, async (baseUrl) => {
      const landing = await fetch(`${baseUrl}/`);
      const landingHtml = await landing.text();
      expect(landing.status).toBe(200);
      expect(landingHtml).toContain('<title>GlideHero</title>');
      expect(landingHtml).toContain('Create account');

      const signup = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
          displayName: 'Sky Pilot',
        }),
      });
      expect(signup.status).toBe(303);
      const signupCookie = signup.headers.get('set-cookie')?.split(';', 1)[0];
      expect(signupCookie).toMatch(/^glidehero_session=/);

      const signedIn = await fetch(`${baseUrl}/`, { headers: { cookie: signupCookie ?? '' } });
      expect(await signedIn.text()).toContain('Sky Pilot');

      const logout = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: signupCookie ?? '' },
      });
      expect(logout.status).toBe(303);
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
        }),
      });
      expect(login.status).toBe(303);
      const loginCookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      const signedInAgain = await fetch(`${baseUrl}/`, { headers: { cookie: loginCookie ?? '' } });
      expect(await signedInAgain.text()).toContain('pilot@example.com');
    });
  });
});
```

- [ ] **Step 2: Run the real flow before documentation**

Run: `TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration -- webFlow.integration.test.ts`

Expected: PASS with a real migrated PostgreSQL database, real password hashing, real Vento rendering, and real cookie headers.

- [ ] **Step 3: Add the non-secret environment template**

Create `.env.example`:

```dotenv
DATABASE_URL=postgres://localhost/glidehero
ENVIRONMENT=development
PORT=3000
SESSION_COOKIE_NAME=glidehero_session
SESSION_TTL_SECONDS=604800
```

Change the environment rules in `.gitignore` to keep secrets ignored while allowing this template:

```gitignore
.env*
!.env.example
```

Keep `.env` and `.env.test` ignored. The test database URL is supplied explicitly as `TEST_DATABASE_URL` and must name a disposable database.

- [ ] **Step 4: Replace the README with the exact local runbook**

Replace `README.md` with:

````markdown
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
npm run db:migrate
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

Integration tests drop and recreate the `public` schema in the test database.
Never point `TEST_DATABASE_URL` at development or production data.

## Production notes

Set `ENVIRONMENT=production` so the session cookie receives the `Secure`
attribute. Terminate HTTPS before traffic reaches the application, apply migrations
before starting a new release, and provide `DATABASE_URL` through the deployment
secret store.
````

- [ ] **Step 5: Verify all automated gates from a clean build**

Run:

```bash
npm test
TEST_DATABASE_URL=postgres://localhost/glidehero_test npm run test:integration
npm run typecheck
npm run build
```

Expected: unit tests PASS, schema/service/browser integration tests PASS, TypeScript exits 0, and `dist/src/index.js` exists.

- [ ] **Step 6: Verify the built server and forms over real HTTP**

In terminal one:

```bash
DATABASE_URL=postgres://localhost/glidehero PORT=3000 node dist/src/index.js
```

Expected startup line: `GlideHero listening on http://localhost:3000`.

In terminal two:

```bash
curl --fail --silent http://localhost:3000/v1/up
curl --fail --silent http://localhost:3000/ | rg 'GlideHero|action="/login"|action="/signup"'
curl --include --silent --cookie-jar /tmp/glidehero.cookies \
  --data-urlencode 'email=pilot@example.com' \
  --data-urlencode 'password=correct horse battery staple' \
  --data-urlencode 'displayName=Sky Pilot' \
  http://localhost:3000/signup
curl --fail --silent --cookie /tmp/glidehero.cookies http://localhost:3000/ | rg 'Sky Pilot|action="/logout"'
```

Expected: health returns `{"ok":true,"app":"GlideHero"}`; the anonymous page contains both forms; signup returns 303 plus an HTTP-only cookie; the authenticated page contains `Sky Pilot` and logout.

- [ ] **Step 7: Prove naming cleanup in both tracked contents and filenames**

Run this split-string scan so the plan itself does not reintroduce a prohibited contiguous identifier:

```bash
legacy_one='pi''cklefeed'
legacy_two='pi''ckleapp-api'
legacy_three='pi''ckleapp'
legacy_four='pi''ckle'
pattern="$legacy_one|$legacy_two|$legacy_three|$legacy_four"
git grep -IinE "$pattern" -- . ':!package-lock.json'
git ls-files | rg -i "$pattern"
rg -n 'My App|Hello World' src public package.json README.md
```

Expected: every command produces no output and exits 1 because no match exists. Then run `git grep -IinE "$pattern" -- package-lock.json` separately; it must also produce no output.

- [ ] **Step 8: Review the final tracked diff for scope and secrets**

Run: `git status --short && git diff --check && git diff --stat && git diff -- . ':!.env' ':!.env.test'`

Expected: only milestone files are changed, `git diff --check` is silent, no secret values or plaintext test passwords appear outside test fixtures and documented curl examples, and no deferred product subsystem has been added.

- [ ] **Step 9: Commit the runnable milestone**

```bash
git add .gitignore .env.example README.md test/integration/webFlow.integration.test.ts
git commit -m "docs: add GlideHero startup and verification guide"
```

## Completion Checklist

- [ ] `npm test` passes.
- [ ] PostgreSQL schema, authentication service, and browser-flow integration tests pass.
- [ ] `npm run typecheck` and `npm run build` pass.
- [ ] Migrations apply from an empty database.
- [ ] The built server starts using only the documented runtime settings.
- [ ] Anonymous, signup, authenticated, logout, and login states work over HTTP.
- [ ] Session cookies have `HttpOnly`, `SameSite=Lax`, `Path=/`, and production `Secure` attributes.
- [ ] Password and raw session values are absent from PostgreSQL.
- [ ] Tracked contents and filenames contain no legacy product identifier.
- [ ] Visible metadata and copy consistently use `GlideHero`.

---
