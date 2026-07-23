import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlightProcessingService, duplicateFlightMessage } from '../../src/services/flightProcessingService.js';
import { createGridClaimService } from '../../src/services/gridClaimService.js';

const gridClaim = vi.hoisted(() => ({ processInTransaction: vi.fn() }));

vi.mock('../../src/services/gridClaimService.js', () => ({
  createGridClaimService: vi.fn(() => gridClaim),
}));

afterEach(() => {
  gridClaim.processInTransaction.mockReset();
});

const ownerUserId = '00000000-0000-4000-8000-000000000001';
const igcFileId = '00000000-0000-4000-8000-000000000010';
const flightId = '00000000-0000-4000-8000-000000000020';
const bucketKey = 'glidehero/flight.igc';
const processingToken = 'processing-token-1';
const validIgc = [
  'AXXXGLIDEHERO',
  'HFDTE120726',
  'B1200004000000N10500000WA0123401234',
  'B1200044000060N10500060WA0123501235',
].join('\n');

function databaseDouble(options: { events?: string[]; transactionError?: Error; flightInsertError?: unknown; fenceLost?: boolean } = {}) {
  const insertedPoints: unknown[] = [];
  const flightUpdates: Record<string, unknown>[] = [];
  const returning = vi.fn(async () => {
    if (options.flightInsertError) throw options.flightInsertError;
    return [{ id: flightId }];
  });
  const insertFlightValues = vi.fn(() => ({ returning }));
  const updateReturning = vi.fn(async () => [{ id: flightId }]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn((update: Record<string, unknown>) => {
    flightUpdates.push(update);
    return { where: updateWhere };
  });
  const txInsertValues = vi.fn((values: unknown) => {
    if (Array.isArray(values)) {
      return (async () => {
        if (options.transactionError) throw options.transactionError;
        insertedPoints.push(...values);
      })();
    }
    return {
      returning: vi.fn(async () => {
        if (options.transactionError) throw options.transactionError;
        options.events?.push('activity-published');
        return [{ id: 'activity-id' }];
      }),
    };
  });
  const txUpdateReturning = vi.fn(async () => options.fenceLost ? [] : [{
    id: flightId,
    actorUserId: ownerUserId,
    processedAt: new Date('2026-07-20T00:00:00Z'),
  }]);
  const txUpdateWhere = vi.fn(() => ({ returning: txUpdateReturning }));
  const txUpdateSet = vi.fn((update: Record<string, unknown>) => {
    flightUpdates.push(update);
    return { where: txUpdateWhere };
  });
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
    options.events?.push('ingest-started');
    const insertedPointsBefore = insertedPoints.length;
    const flightUpdatesBefore = flightUpdates.length;
    try {
      await callback({
        insert: vi.fn(() => ({ values: txInsertValues })),
        update: vi.fn(() => ({ set: txUpdateSet })),
        execute: vi.fn(async () => ({ rows: [] })),
      });
      options.events?.push('ingest-committed');
    } catch (error) {
      insertedPoints.splice(insertedPointsBefore);
      flightUpdates.splice(flightUpdatesBefore);
      throw error;
    }
  });
  const database = {
    insert: vi.fn(() => ({ values: insertFlightValues })),
    update: vi.fn(() => ({ set: updateSet })),
    transaction,
  };

  return { database, insertedPoints, flightUpdates, insertFlightValues, transaction };
}

function objectBody(source: string) {
  return { Body: { transformToString: vi.fn(async () => source) } };
}

describe('FlightProcessingService', () => {
  it('reads the stored object, inserts ordered points, and completes the flight', async () => {
    const events: string[] = [];
    const { database, insertedPoints, flightUpdates, insertFlightValues, transaction } = databaseDouble({ events });
    const send = vi.fn(async () => objectBody(validIgc));
    gridClaim.processInTransaction.mockImplementation(async () => {
      events.push('grid-claim-processed');
      return {
        flightId,
        cellSize: 1000,
        directCellCount: 0,
        enclosedCellCount: 0,
        newPersonalCellCount: 0,
        personalCellTotalAfter: 0,
        progressionVersion: 1,
        evaluatedAt: new Date('2026-07-20T00:00:00Z'),
      };
    });
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    expect(createGridClaimService).toHaveBeenCalledWith(database, { cellSize: 1000 });
    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken })).resolves.toEqual({ status: 'completed', flightId });

    expect(insertFlightValues).toHaveBeenCalledWith({ userId: ownerUserId, igcFileId, contentHash: 'a'.repeat(64), processingToken });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: bucketKey }) }),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(gridClaim.processInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { flightId, userId: ownerUserId, launchTimezone: 'America/Denver' },
    );
    expect(events).toEqual([
      'ingest-started',
      'grid-claim-processed',
      'activity-published',
      'ingest-committed',
    ]);
    expect(insertedPoints).toEqual([
      expect.objectContaining({ flightId, sequenceNumber: 0, latitude: 40, longitude: -105 }),
      expect.objectContaining({ flightId, sequenceNumber: 1 }),
    ]);
    expect(flightUpdates).toEqual([
      expect.objectContaining({
        durationSeconds: 4,
        launchLatitude: 40,
        launchLongitude: -105,
        launchTimezone: 'America/Denver',
      }),
      expect.objectContaining({
        processingStatus: 'completed',
        processingToken: null,
        processingError: null,
        processedAt: expect.objectContaining({
          queryChunks: [expect.objectContaining({ value: ['clock_timestamp()'] })],
        }),
      }),
    ]);
  });

  it('passes injected Arena projection dependencies through to grid claim processing', () => {
    const userAchievementProgress = { upsertFromArenaSnapshotInTransaction: vi.fn() };
    const userArenaProgress = { applyFlightInTransaction: vi.fn() };
    const { database } = databaseDouble();

    createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send: vi.fn() } as never,
      gridClaimCellSize: 1000,
      userAchievementProgress: userAchievementProgress as never,
      userArenaProgress: userArenaProgress as never,
    });

    expect(createGridClaimService).toHaveBeenCalledWith(
      database,
      { cellSize: 1000 },
      undefined,
      undefined,
      undefined,
      userAchievementProgress,
      userArenaProgress,
    );
  });

  it('keeps the flight and source when parsing fails', async () => {
    const { database, insertedPoints, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => objectBody('AXXXGLIDEHERO\nHFDTE120726'));
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken })).resolves.toEqual({
      status: 'failed',
      flightId,
      message: 'This IGC file has no valid GPS fixes to process.',
    });

    expect(flightUpdates).toContainEqual({
      processingStatus: 'failed',
      processingToken: null,
      processingError: 'This IGC file has no valid GPS fixes to process.',
    });
    expect(flightUpdates.every((update) => !('processedAt' in update))).toBe(true);
    expect(insertedPoints).toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps a failed flight when the stored object cannot be read', async () => {
    const { database, insertedPoints, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => { throw new Error('S3 unavailable'); });
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken })).resolves.toEqual({
      status: 'failed',
      flightId,
      message: 'We could not read your uploaded IGC file. Please upload it again.',
    });
    expect(flightUpdates).toContainEqual({
      processingStatus: 'failed',
      processingToken: null,
      processingError: 'We could not read your uploaded IGC file. Please upload it again.',
    });
    expect(flightUpdates.every((update) => !('processedAt' in update))).toBe(true);
    expect(insertedPoints).toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('propagates unexpected transactional persistence failures', async () => {
    const persistenceError = new Error('database unavailable');
    const { database, flightUpdates } = databaseDouble({ transactionError: persistenceError });
    const send = vi.fn(async () => objectBody(validIgc));
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken })).rejects.toBe(persistenceError);
    expect(flightUpdates).not.toContainEqual(expect.objectContaining({ processingStatus: 'failed' }));
  });

  it('rolls back track work when stale failure wins the database processing fence', async () => {
    const { database, insertedPoints, transaction } = databaseDouble({ fenceLost: true });
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files', s3Client: { send: vi.fn() } as never, gridClaimCellSize: 1000,
    });

    await expect(service.process({
      ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken, source: validIgc,
    })).resolves.toEqual({ status: 'superseded', flightId });

    expect(transaction).toHaveBeenCalledOnce();
    expect(insertedPoints).toEqual([]);
    expect(gridClaim.processInTransaction).not.toHaveBeenCalled();
  });

  it('rolls back the completed flight and track work when GridClaim fails', async () => {
    const claimError = new Error('PostGIS unavailable');
    const { database, insertedPoints, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => objectBody(validIgc));
    gridClaim.processInTransaction.mockImplementation(async () => { throw claimError; });
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken })).rejects.toBe(claimError);

    expect(transaction).toHaveBeenCalledOnce();
    expect(gridClaim.processInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { flightId, userId: ownerUserId, launchTimezone: 'America/Denver' },
    );
    expect(insertedPoints).toEqual([]);
    expect(flightUpdates).not.toContainEqual(expect.objectContaining({ processingStatus: 'completed' }));
  });

  it('converts the content-hash unique conflict to a duplicate outcome before reading the source', async () => {
    const { database } = databaseDouble({
      flightInsertError: { code: '23505', constraint: 'flights_content_hash_unique' },
    });
    const send = vi.fn();
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken }))
      .resolves.toEqual({ status: 'duplicate', message: 'This flight has already been uploaded.' });
    expect(send).not.toHaveBeenCalled();
  });

  it('converts a Drizzle-wrapped content-hash unique conflict to a duplicate outcome before reading the source', async () => {
    const { database } = databaseDouble({
      flightInsertError: new DrizzleQueryError('insert into flights', [], Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint: 'flights_content_hash_unique',
      })),
    });
    const send = vi.fn();
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      gridClaimCellSize: 1000,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey, contentHash: 'a'.repeat(64), processingToken }))
      .resolves.toEqual({ status: 'duplicate', message: duplicateFlightMessage });
    expect(send).not.toHaveBeenCalled();
  });
});
