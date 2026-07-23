import { sql, type SQL } from 'drizzle-orm';

type LockExecutor = { execute: (query: SQL) => Promise<unknown> };

export async function lockArenaCatalogShared(executor: LockExecutor): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('glidehero:arena-catalog'::text, 0))`);
}

export async function lockArenaCatalogExclusive(executor: LockExecutor): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('glidehero:arena-catalog'::text, 0))`);
}
