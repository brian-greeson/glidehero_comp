import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createBucketClient } from './resources/bucketClient.js';
import { createThermalProcessingService } from './services/thermalProcessingService.js';
import { createThermalKkClient } from './resources/thermalKkClient.js';
import { createThermalRasterCacheService } from './services/thermalRasterCacheService.js';
import { createThermalCrawlService } from './services/thermalCrawlService.js';

const { values } = parseArgs({ options: { once: { type: 'boolean', default: false } } });
const config = parseConfig(process.env);
const { db, pool } = createDatabase(config.databaseUrl);
const s3Client = createBucketClient(config);
const processing = createThermalProcessingService(db, { s3Client, bucketName: config.bucket.bucketName });
const rasterCache = createThermalRasterCacheService(
  db,
  createThermalKkClient({ sourceHostname: config.thermalKkSourceHostname }),
  { s3Client, bucketName: config.bucket.bucketName, bucketFolder: config.bucket.bucketFolder },
);
const crawl = createThermalCrawlService(db);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopping = true; });

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  do {
    const tile = await processing.claimNext(workerId);
    if (!tile) {
      const crawlTile = await crawl.claimNext(workerId);
      if (crawlTile) {
        try {
          const cached = await rasterCache.get({ zoom: crawlTile.zoom, x: crawlTile.tileX, tmsY: crawlTile.tmsY });
          const tileRow = cached ? await db.execute<{ id: string }>(
            sql`SELECT id FROM thermal_raster_tiles
              WHERE source_layer_key = 'thermals_all_all' AND zoom = ${crawlTile.zoom}
                AND tile_x = ${crawlTile.tileX} AND tms_y = ${crawlTile.tmsY}`,
          ) : null;
          await crawl.complete(crawlTile, workerId, tileRow?.rows[0]?.id ?? null, cached === null);
          if (cached?.cache === 'miss') await wait(1_000);
        } catch (error) {
          await crawl.fail(crawlTile, workerId, error);
          console.error(`Unable to cache thermal tile ${crawlTile.zoom}/${crawlTile.tileX}/${crawlTile.tmsY}.`, error);
        }
        continue;
      }
      if (values.once) break;
      await wait(2_000);
      continue;
    }
    try {
      const result = await processing.process(tile, workerId);
      console.log(`Processed thermal tile ${tile.zoom}/${tile.tileX}/${tile.tmsY}: ${result.areaCount} areas.`);
    } catch (error) {
      await processing.fail(tile.id, workerId, error);
      console.error(`Unable to process thermal tile ${tile.zoom}/${tile.tileX}/${tile.tmsY}.`, error);
    }
  } while (!stopping && !values.once);
} finally {
  await pool.end();
}
