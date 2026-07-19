import { createHash } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';
import { parseConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { igcFiles } from '../db/schema.js';
import { createBucketClient } from '../resources/bucketClient.js';
import { flightUploadPrefix } from '../services/flightUploadQueueService.js';

const usage = `Usage: npx tsx --env-file=.env src/scripts/migrateIgcBucketKeys.ts [--apply]

Inspect IGC bucket keys and print the legacy-to-canonical migration plan.
Dry-run is the default: it is read-only, audits direct glidehero/<UUID>.igc objects,
and reports unidentified keys without deleting them.
Before --apply, pause the flight worker and drain the upload queue so no new legacy writes or
database races occur during the migration.
Apply mode copies and verifies each object, updates the database, deletes only verified sources,
then reruns the database inventory and bucket audit. Rerun --apply after a failure; existing
verified destinations are recovered, while conflicts stop safely for manual review.

Direct commands:
  npx tsx --env-file=.env src/scripts/migrateIgcBucketKeys.ts
  npx tsx --env-file=.env src/scripts/migrateIgcBucketKeys.ts --apply

Options:
  --apply  Copy and verify objects, update the database, delete verified sources, and run the final audit.
  --help   Show this help message.

Apply succeeds only when no database-backed legacy keys, verified legacy duplicates,
or migration conflicts remain. Unidentified root objects are reported for manual review
but are never required to be deleted.`;

const legacyKeyPattern = /^glidehero\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.igc$/i;
const canonicalFilenamePattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.igc$/i;

type IgcFileRow = {
  id: string;
  userId: string;
  byteSize: number;
  bucketKey: string;
};

type BucketClient = ReturnType<typeof createBucketClient>;

type DatabaseInventory = {
  rows: IgcFileRow[];
  legacyRows: IgcFileRow[];
  canonicalRows: IgcFileRow[];
  unexpectedKeys: string[];
};

type BucketAudit = {
  referencedLegacyKeys: string[];
  verifiedDuplicateKeys: string[];
  unidentifiedRootKeys: string[];
  conflictKeys: string[];
};

class MigrationFailure extends Error {
  constructor(row: IgcFileRow, oldKey: string, newKey: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super([
      `Migration failed for IGC file ${row.id}.`,
      `Old key: ${oldKey}`,
      `New key: ${newKey}`,
      message,
    ].join('\n'));
    this.name = 'MigrationFailure';
  }
}

function printHelp(): void {
  console.log(usage);
}

function migrationKey(bucketFolder: string, userId: string, bucketKey: string): string | null {
  const match = legacyKeyPattern.exec(bucketKey);
  if (!match) return null;
  return `${flightUploadPrefix(bucketFolder, userId)}${match[1]}.igc`;
}

function legacyKeyForCanonical(bucketFolder: string, userId: string, bucketKey: string): string | null {
  const prefix = flightUploadPrefix(bucketFolder, userId);
  if (!bucketKey.startsWith(prefix)) return null;
  const match = canonicalFilenamePattern.exec(bucketKey.slice(prefix.length));
  return match ? `glidehero/${match[1]}.igc` : null;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = candidate.Code ?? candidate.code ?? candidate.name;
  const objectNotFound = code === 'NotFound' || code === 'NoSuchKey';
  const statusIsNotFound = candidate.$metadata?.httpStatusCode === 404;
  return (objectNotFound && (!candidate.$metadata || statusIsNotFound))
    || (!code && statusIsNotFound);
}

async function readObject(s3Client: BucketClient, bucketName: string, key: string): Promise<Uint8Array> {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if (!object.Body) throw new Error(`Object ${key} has no body.`);
  return object.Body.transformToByteArray();
}

async function headObjectOrNull(s3Client: BucketClient, bucketName: string, key: string) {
  try {
    return await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function requireObjectPresent(s3Client: BucketClient, bucketName: string, key: string) {
  const object = await headObjectOrNull(s3Client, bucketName, key);
  if (!object) throw new Error(`Object does not exist: ${key}`);
  return object;
}

async function requireObjectAbsent(s3Client: BucketClient, bucketName: string, key: string, description: string): Promise<void> {
  const object = await headObjectOrNull(s3Client, bucketName, key);
  if (object) throw new Error(`${description}: ${key}`);
}

async function verifyObjectsMatch(
  s3Client: BucketClient,
  bucketName: string,
  sourceKey: string,
  destinationKey: string,
  sourceHead: { ContentLength?: number },
  destinationHead: { ContentLength?: number },
  expectedSize?: number,
): Promise<boolean> {
  if (sourceHead.ContentLength === undefined || destinationHead.ContentLength === undefined) return false;
  if (expectedSize !== undefined
    && (sourceHead.ContentLength !== expectedSize || destinationHead.ContentLength !== expectedSize)) {
    return false;
  }
  if (sourceHead.ContentLength !== destinationHead.ContentLength) return false;

  const sourceBytes = await readObject(s3Client, bucketName, sourceKey);
  const destinationBytes = await readObject(s3Client, bucketName, destinationKey);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const destinationHash = createHash('sha256').update(destinationBytes).digest('hex');
  return sourceHash === destinationHash;
}

async function confirmDatabaseKey(
  db: ReturnType<typeof createDatabase>['db'],
  rowId: string,
  expectedBucketKey: string,
): Promise<void> {
  const [current] = await db
    .select({ bucketKey: igcFiles.bucketKey })
    .from(igcFiles)
    .where(eq(igcFiles.id, rowId))
    .limit(1);
  if (!current || current.bucketKey !== expectedBucketKey) {
    throw new Error(`Database row no longer points at the intended destination ${expectedBucketKey}.`);
  }
}

async function deleteAndConfirmSource(s3Client: BucketClient, bucketName: string, key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  await requireObjectAbsent(s3Client, bucketName, key, 'Source object still exists after deletion');
}

async function updateDatabaseKey(
  db: ReturnType<typeof createDatabase>['db'],
  row: IgcFileRow,
  newKey: string,
): Promise<void> {
  const updatedRows = await db
    .update(igcFiles)
    .set({ bucketKey: newKey })
    .where(and(eq(igcFiles.id, row.id), eq(igcFiles.bucketKey, row.bucketKey)))
    .returning({ id: igcFiles.id });
  if (updatedRows.length === 1) return;
  if (updatedRows.length > 1) {
    throw new Error(`Expected exactly one database row to update, got ${updatedRows.length}.`);
  }
  await confirmDatabaseKey(db, row.id, newKey);
}

async function migrateLegacyRow(
  db: ReturnType<typeof createDatabase>['db'],
  s3Client: BucketClient,
  bucketName: string,
  row: IgcFileRow,
  newKey: string,
): Promise<void> {
  const sourceHead = await requireObjectPresent(s3Client, bucketName, row.bucketKey);
  if (sourceHead.ContentLength !== row.byteSize) {
    throw new Error(`Source size ${sourceHead.ContentLength ?? 'unknown'} does not match database size ${row.byteSize}.`);
  }

  const destinationHead = await headObjectOrNull(s3Client, bucketName, newKey);
  if (destinationHead) {
    const matches = await verifyObjectsMatch(
      s3Client,
      bucketName,
      row.bucketKey,
      newKey,
      sourceHead,
      destinationHead,
      row.byteSize,
    );
    if (!matches) {
      throw new Error(`Source and destination differ; manual collision review is required for ${newKey}.`);
    }
  } else {
    await s3Client.send(new CopyObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      CopySource: encodeURIComponent(`${bucketName}/${row.bucketKey}`),
    }));

    const copiedDestinationHead = await requireObjectPresent(s3Client, bucketName, newKey);
    if (copiedDestinationHead.ContentLength !== row.byteSize) {
      throw new Error(`Destination size ${copiedDestinationHead.ContentLength ?? 'unknown'} does not match database size ${row.byteSize}.`);
    }
    const matches = await verifyObjectsMatch(
      s3Client,
      bucketName,
      row.bucketKey,
      newKey,
      sourceHead,
      copiedDestinationHead,
      row.byteSize,
    );
    if (!matches) {
      throw new Error(`Source and destination SHA-256 hashes differ for ${newKey}.`);
    }
  }

  await updateDatabaseKey(db, row, newKey);
  await confirmDatabaseKey(db, row.id, newKey);
  await deleteAndConfirmSource(s3Client, bucketName, row.bucketKey);
}

async function recoverCanonicalRow(
  db: ReturnType<typeof createDatabase>['db'],
  s3Client: BucketClient,
  bucketName: string,
  row: IgcFileRow,
  legacyKey: string,
): Promise<void> {
  const canonicalHead = await requireObjectPresent(s3Client, bucketName, row.bucketKey);
  const legacyHead = await requireObjectPresent(s3Client, bucketName, legacyKey);
  const matches = await verifyObjectsMatch(
    s3Client,
    bucketName,
    legacyKey,
    row.bucketKey,
    legacyHead,
    canonicalHead,
    row.byteSize,
  );
  if (!matches) {
    throw new Error(`Canonical and legacy objects differ; manual collision review is required for ${row.bucketKey}.`);
  }

  await confirmDatabaseKey(db, row.id, row.bucketKey);
  await deleteAndConfirmSource(s3Client, bucketName, legacyKey);
}

async function inspectLegacyRow(
  s3Client: BucketClient,
  bucketName: string,
  row: IgcFileRow,
  newKey: string,
): Promise<'migration-needed' | 'existing-destination' | 'collision'> {
  const sourceHead = await headObjectOrNull(s3Client, bucketName, row.bucketKey);
  const destinationHead = await headObjectOrNull(s3Client, bucketName, newKey);
  if (!destinationHead) return 'migration-needed';
  if (!sourceHead) return 'existing-destination';
  const matches = await verifyObjectsMatch(
    s3Client,
    bucketName,
    row.bucketKey,
    newKey,
    sourceHead,
    destinationHead,
    row.byteSize,
  );
  return matches ? 'existing-destination' : 'collision';
}

async function inspectCanonicalDuplicate(
  s3Client: BucketClient,
  bucketName: string,
  row: IgcFileRow,
  legacyKey: string,
): Promise<'none' | 'duplicate' | 'collision'> {
  const legacyHead = await headObjectOrNull(s3Client, bucketName, legacyKey);
  if (!legacyHead) return 'none';
  const canonicalHead = await headObjectOrNull(s3Client, bucketName, row.bucketKey);
  if (!canonicalHead) return 'duplicate';
  const matches = await verifyObjectsMatch(
    s3Client,
    bucketName,
    legacyKey,
    row.bucketKey,
    legacyHead,
    canonicalHead,
  );
  return matches ? 'duplicate' : 'collision';
}

async function selectIgcRows(db: ReturnType<typeof createDatabase>['db']): Promise<IgcFileRow[]> {
  return db
    .select({
      id: igcFiles.id,
      userId: igcFiles.userId,
      byteSize: igcFiles.byteSize,
      bucketKey: igcFiles.bucketKey,
    })
    .from(igcFiles)
    .orderBy(igcFiles.id);
}

function summarizeDatabaseRows(rows: IgcFileRow[], bucketFolder: string): DatabaseInventory {
  const legacyRows: IgcFileRow[] = [];
  const canonicalRows: IgcFileRow[] = [];
  const unexpectedKeys: string[] = [];

  for (const row of rows) {
    const canonicalPrefix = flightUploadPrefix(bucketFolder, row.userId);
    if (migrationKey(bucketFolder, row.userId, row.bucketKey)) {
      legacyRows.push(row);
    } else if (row.bucketKey.startsWith(canonicalPrefix)) {
      canonicalRows.push(row);
    } else {
      unexpectedKeys.push(row.bucketKey);
    }
  }

  return { rows, legacyRows, canonicalRows, unexpectedKeys };
}

async function listLegacyRootKeys(s3Client: BucketClient, bucketName: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'glidehero/',
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key && legacyKeyPattern.test(object.Key)) keys.push(object.Key);
    }
    const nextToken = page.NextContinuationToken;
    if (!nextToken || nextToken === continuationToken) break;
    continuationToken = nextToken;
  } while (continuationToken);

  return keys;
}

async function auditBucket(
  s3Client: BucketClient,
  bucketName: string,
  inventory: DatabaseInventory,
  bucketFolder: string,
): Promise<BucketAudit> {
  const legacyRowsByKey = new Map<string, IgcFileRow[]>();
  const canonicalRowsByLegacyKey = new Map<string, IgcFileRow[]>();
  for (const row of inventory.legacyRows) {
    const rows = legacyRowsByKey.get(row.bucketKey) ?? [];
    rows.push(row);
    legacyRowsByKey.set(row.bucketKey, rows);
  }
  for (const row of inventory.canonicalRows) {
    const legacyKey = legacyKeyForCanonical(bucketFolder, row.userId, row.bucketKey);
    if (!legacyKey) continue;
    const rows = canonicalRowsByLegacyKey.get(legacyKey) ?? [];
    rows.push(row);
    canonicalRowsByLegacyKey.set(legacyKey, rows);
  }

  const referencedLegacyKeys: string[] = [];
  const verifiedDuplicateKeys: string[] = [];
  const unidentifiedRootKeys: string[] = [];
  const conflictKeys: string[] = [];

  for (const key of await listLegacyRootKeys(s3Client, bucketName)) {
    if (legacyRowsByKey.has(key)) {
      referencedLegacyKeys.push(key);
      continue;
    }

    const canonicalRows = canonicalRowsByLegacyKey.get(key);
    if (!canonicalRows) {
      unidentifiedRootKeys.push(key);
      continue;
    }

    const rootHead = await headObjectOrNull(s3Client, bucketName, key);
    if (!rootHead) continue;

    let verified = false;
    let conflicted = false;
    for (const row of canonicalRows) {
      const canonicalHead = await headObjectOrNull(s3Client, bucketName, row.bucketKey);
      if (!canonicalHead) {
        conflicted = true;
        continue;
      }
      if (await verifyObjectsMatch(s3Client, bucketName, key, row.bucketKey, rootHead, canonicalHead, row.byteSize)) {
        verified = true;
      } else {
        conflicted = true;
      }
    }

    if (verified) {
      verifiedDuplicateKeys.push(key);
    } else {
      unidentifiedRootKeys.push(key);
    }
    if (conflicted) conflictKeys.push(key);
  }

  return { referencedLegacyKeys, verifiedDuplicateKeys, unidentifiedRootKeys, conflictKeys };
}

function printUnidentifiedRootKeys(keys: string[]): void {
  if (keys.length === 0) return;
  console.log('Unidentified root-level IGC objects:');
  for (const key of keys) console.log(key);
}

function printFinalSummary(input: {
  databaseRowsMigrated: number;
  legacyDuplicatesRemoved: number;
  verifiedLegacyDuplicatesRemaining: number;
  remainingDatabaseBackedLegacyObjects: number;
  unidentifiedRootObjects: number;
  unexpectedDatabaseKeys: number;
  conflicts: number;
}): void {
  console.log('Final summary:');
  console.log(`Database rows migrated: ${input.databaseRowsMigrated}`);
  console.log(`Legacy duplicates removed: ${input.legacyDuplicatesRemoved}`);
  console.log(`Verified legacy duplicates remaining: ${input.verifiedLegacyDuplicatesRemaining}`);
  console.log(`Remaining database-backed legacy objects: ${input.remainingDatabaseBackedLegacyObjects}`);
  console.log(`Unidentified root-level IGC objects: ${input.unidentifiedRootObjects}`);
  console.log(`Unexpected database keys: ${input.unexpectedDatabaseKeys}`);
  console.log(`Conflicts: ${input.conflicts}`);
}

async function run(args: string[]): Promise<void> {
  const apply = args.length === 1 && args[0] === '--apply';
  if (args.length > 0 && !apply) {
    throw new Error(`Unknown argument: ${args[0] ?? ''}\n\n${usage}`);
  }

  const config = parseConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  let migratedCount = 0;
  let legacyDuplicatesRemoved = 0;

  try {
    const s3Client = createBucketClient(config);
    const rows = await selectIgcRows(db);

    let legacyCount = 0;
    let canonicalCount = 0;
    const unexpectedKeys: string[] = [];
    let migrationsNeeded = 0;
    let existingDestinations = 0;
    let canonicalDuplicates = 0;
    let collisions = 0;

    for (const row of rows) {
      const canonicalPrefix = flightUploadPrefix(config.bucket.bucketFolder, row.userId);
      const newKey = migrationKey(config.bucket.bucketFolder, row.userId, row.bucketKey);

      if (newKey) {
        legacyCount += 1;
        console.log(`${row.bucketKey} -> ${newKey}`);
        if (apply) {
          try {
            await migrateLegacyRow(db, s3Client, config.bucket.bucketName, row, newKey);
          } catch (error) {
            throw new MigrationFailure(row, row.bucketKey, newKey, error);
          }
          migratedCount += 1;
        } else {
          const state = await inspectLegacyRow(s3Client, config.bucket.bucketName, row, newKey);
          if (state === 'migration-needed') {
            migrationsNeeded += 1;
          } else if (state === 'existing-destination') {
            existingDestinations += 1;
          } else {
            collisions += 1;
          }
        }
      } else if (row.bucketKey.startsWith(canonicalPrefix)) {
        canonicalCount += 1;
        const legacyKey = legacyKeyForCanonical(config.bucket.bucketFolder, row.userId, row.bucketKey);
        if (!legacyKey) continue;

        if (apply) {
          try {
            const legacyHead = await headObjectOrNull(s3Client, config.bucket.bucketName, legacyKey);
            if (legacyHead) {
              await recoverCanonicalRow(db, s3Client, config.bucket.bucketName, row, legacyKey);
              legacyDuplicatesRemoved += 1;
            }
          } catch (error) {
            throw new MigrationFailure(row, legacyKey, row.bucketKey, error);
          }
        } else {
          const state = await inspectCanonicalDuplicate(s3Client, config.bucket.bucketName, row, legacyKey);
          if (state === 'duplicate') {
            canonicalDuplicates += 1;
          } else if (state === 'collision') {
            canonicalDuplicates += 1;
            collisions += 1;
          }
        }
      } else {
        unexpectedKeys.push(row.bucketKey);
      }
    }

    console.log(`Totals: legacy=${legacyCount}, canonical=${canonicalCount}, unexpected=${unexpectedKeys.length}`);
    if (unexpectedKeys.length > 0) {
      console.log('Unexpected database keys:');
      for (const key of unexpectedKeys) console.log(key);
    }
    if (!apply) {
      console.log(`Migrations needed: ${migrationsNeeded}`);
      console.log(`Existing destinations awaiting database switch: ${existingDestinations}`);
      console.log(`Canonical rows that may have a legacy duplicate: ${canonicalDuplicates}`);
      console.log(`Collisions that require manual review: ${collisions}`);
    }

    const finalRows = apply ? await selectIgcRows(db) : rows;
    const finalInventory = summarizeDatabaseRows(finalRows, config.bucket.bucketFolder);
    const audit = await auditBucket(s3Client, config.bucket.bucketName, finalInventory, config.bucket.bucketFolder);
    printUnidentifiedRootKeys(audit.unidentifiedRootKeys);
    printFinalSummary({
      databaseRowsMigrated: migratedCount,
      legacyDuplicatesRemoved,
      verifiedLegacyDuplicatesRemaining: audit.verifiedDuplicateKeys.length,
      remainingDatabaseBackedLegacyObjects: finalInventory.legacyRows.length,
      unidentifiedRootObjects: audit.unidentifiedRootKeys.length,
      unexpectedDatabaseKeys: finalInventory.unexpectedKeys.length,
      conflicts: collisions + audit.conflictKeys.length,
    });

    const finalConflicts = collisions + audit.conflictKeys.length;
    if (apply && (
      finalInventory.legacyRows.length > 0
      || audit.verifiedDuplicateKeys.length > 0
      || finalConflicts > 0
    )) {
      throw new Error([
        'Final audit did not meet migration success criteria.',
        `Database-backed legacy objects remaining: ${finalInventory.legacyRows.length}.`,
        `Verified legacy duplicates remaining: ${audit.verifiedDuplicateKeys.length}.`,
        `Conflicts: ${finalConflicts}.`,
      ].join('\n'));
    }
    if (apply) {
      console.log(`Migration completed successfully. Successfully migrated objects: ${migratedCount}`);
    }
  } catch (error) {
    if (apply) console.log(`Migration stopped after ${migratedCount} successfully migrated object(s).`);
    throw error;
  } finally {
    await pool.end();
  }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  printHelp();
} else {
  try {
    await run(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
