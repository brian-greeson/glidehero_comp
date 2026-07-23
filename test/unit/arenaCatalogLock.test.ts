import { describe, expect, it } from 'vitest';
import { lockArenaCatalogExclusive, lockArenaCatalogShared } from '../../src/services/arenaCatalogLock.js';

describe('Arena catalog advisory locks', () => {
  it('uses shared and exclusive transaction locks on the same key', async () => {
    const queries: unknown[] = [];
    const executor = { execute: async (query: unknown) => { queries.push(query); } };
    await lockArenaCatalogShared(executor);
    await lockArenaCatalogExclusive(executor);
    expect(queries).toHaveLength(2);
    const sharedSql = JSON.stringify(queries[0]);
    const exclusiveSql = JSON.stringify(queries[1]);
    expect(sharedSql).toContain('pg_advisory_xact_lock_shared');
    expect(exclusiveSql).toContain('pg_advisory_xact_lock');
    expect(exclusiveSql).not.toContain('pg_advisory_xact_lock_shared');
    expect(sharedSql).toContain('glidehero:arena-catalog');
    expect(exclusiveSql).toContain('glidehero:arena-catalog');
  });
});
