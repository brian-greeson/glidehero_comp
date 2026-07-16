import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { launches } from '../db/schema.js';
import { parseMysqlLaunchDump } from '../domain/launch/mysqlLaunchDump.js';

const batchSize = 500;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const sourcePath = resolve(process.argv[2] ?? 'injest/launches.sql');
  const sourceSql = await readFile(sourcePath, 'utf8');
  const rows = parseMysqlLaunchDump(sourceSql);
  const { db, pool } = createDatabase(databaseUrl);

  try {
    await db.transaction(async (transaction) => {
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        await transaction.insert(launches).values(batch).onConflictDoUpdate({
          target: launches.id,
          set: {
            name: sql`excluded.name`,
            longitude: sql`excluded.longitude`,
            latitude: sql`excluded.latitude`,
            country: sql`excluded.country`,
            state: sql`excluded.state`,
            city: sql`excluded.city`,
            description: sql`excluded.description`,
            xcByMonth: sql`excluded.xc_by_month`,
            timezoneOffset: sql`excluded.timezone_offset`,
            xcByYear: sql`excluded.xc_by_year`,
            rank: sql`excluded.rank`,
            elevation: sql`excluded.elevation`,
            rank1: sql`excluded.rank_1`,
            rank2: sql`excluded.rank_2`,
            rank3: sql`excluded.rank_3`,
            rank4: sql`excluded.rank_4`,
            rank5: sql`excluded.rank_5`,
            rank6: sql`excluded.rank_6`,
            rank7: sql`excluded.rank_7`,
            rank8: sql`excluded.rank_8`,
            rank9: sql`excluded.rank_9`,
            rank10: sql`excluded.rank_10`,
            rank11: sql`excluded.rank_11`,
            rank12: sql`excluded.rank_12`,
            xcontestLaunchSite: sql`excluded.xcontest_launch_site`,
          },
        });
      }
    });
    console.log(`Imported ${rows.length} launches from ${sourcePath}.`);
  } finally {
    await pool.end();
  }
}

await main();
