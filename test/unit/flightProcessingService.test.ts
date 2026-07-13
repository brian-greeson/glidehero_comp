import { describe, expect, it, vi } from 'vitest';
import { createFlightProcessingService } from '../../src/services/flightProcessingService.js';

const ownerUserId = '00000000-0000-4000-8000-000000000001';
const igcFileId = '00000000-0000-4000-8000-000000000010';
const flightId = '00000000-0000-4000-8000-000000000020';
const bucketKey = 'glidehero/flight.igc';
const validIgc = [
  'AXXXGLIDEHERO',
  'HFDTE120726',
  'B1200004000000N10500000WA0123401234',
  'B1200044000060N10500060WA0123501235',
].join('\n');

function databaseDouble(options: { events?: string[]; transactionError?: Error } = {}) {
  const insertedPoints: unknown[] = [];
  const flightUpdates: Record<string, unknown>[] = [];
  const returning = vi.fn(async () => [{ id: flightId }]);
  const insertFlightValues = vi.fn(() => ({ returning }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn((update: Record<string, unknown>) => {
    flightUpdates.push(update);
    return { where: updateWhere };
  });
  const txInsertValues = vi.fn(async (points: unknown[]) => {
    if (options.transactionError) throw options.transactionError;
    insertedPoints.push(...points);
  });
  const txUpdateWhere = vi.fn(async () => undefined);
  const txUpdateSet = vi.fn((update: Record<string, unknown>) => {
    flightUpdates.push(update);
    return { where: txUpdateWhere };
  });
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
    options.events?.push('ingest-started');
    await callback({
      insert: vi.fn(() => ({ values: txInsertValues })),
      update: vi.fn(() => ({ set: txUpdateSet })),
    });
    options.events?.push('ingest-committed');
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

function areaDetectionDouble() {
  return { detect: vi.fn(async () => ({ flightId, detectedAreaCount: 0 })) };
}

describe('FlightProcessingService', () => {
  it('reads the stored object, inserts ordered points, and completes the flight', async () => {
    const events: string[] = [];
    const { database, insertedPoints, flightUpdates, insertFlightValues, transaction } = databaseDouble({ events });
    const send = vi.fn(async () => objectBody(validIgc));
    const detect = vi.fn(async () => {
      events.push('areas-detected');
      return { flightId, detectedAreaCount: 0 };
    });
    const service = createFlightProcessingService(database as never, {
      bucketName: 'glidehero-files',
      areaDetection: { detect },
      s3Client: { send } as never,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey })).resolves.toEqual({ status: 'completed', flightId });

    expect(insertFlightValues).toHaveBeenCalledWith({ userId: ownerUserId, igcFileId });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: bucketKey }) }),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledWith({ flightId });
    expect(events).toEqual(['ingest-started', 'ingest-committed', 'areas-detected']);
    expect(insertedPoints).toEqual([
      expect.objectContaining({ flightId, sequenceNumber: 0, latitude: 40, longitude: -105 }),
      expect.objectContaining({ flightId, sequenceNumber: 1 }),
    ]);
    expect(flightUpdates).toContainEqual(expect.objectContaining({
      processingStatus: 'completed',
      processingError: null,
      durationSeconds: 4,
      launchLatitude: 40,
      launchLongitude: -105,
    }));
  });

  it('keeps the flight and source when parsing fails', async () => {
    const { database, insertedPoints, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => objectBody('AXXXGLIDEHERO\nHFDTE120726'));
    const service = createFlightProcessingService(database as never, {
      areaDetection: areaDetectionDouble(),
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey })).resolves.toEqual({
      status: 'failed',
      flightId,
      message: 'This IGC file has no valid GPS fixes to process.',
    });

    expect(flightUpdates).toContainEqual({
      processingStatus: 'failed',
      processingError: 'This IGC file has no valid GPS fixes to process.',
    });
    expect(insertedPoints).toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps a failed flight when the stored object cannot be read', async () => {
    const { database, insertedPoints, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => { throw new Error('S3 unavailable'); });
    const service = createFlightProcessingService(database as never, {
      areaDetection: areaDetectionDouble(),
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey })).resolves.toEqual({
      status: 'failed',
      flightId,
      message: 'We could not read your uploaded IGC file. Please upload it again.',
    });
    expect(flightUpdates).toContainEqual({
      processingStatus: 'failed',
      processingError: 'We could not read your uploaded IGC file. Please upload it again.',
    });
    expect(insertedPoints).toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('propagates unexpected transactional persistence failures', async () => {
    const persistenceError = new Error('database unavailable');
    const { database, flightUpdates } = databaseDouble({ transactionError: persistenceError });
    const send = vi.fn(async () => objectBody(validIgc));
    const service = createFlightProcessingService(database as never, {
      areaDetection: areaDetectionDouble(),
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey })).rejects.toBe(persistenceError);
    expect(flightUpdates).not.toContainEqual(expect.objectContaining({ processingStatus: 'failed' }));
  });

  it('keeps the committed flight when area detection fails for a later retry', async () => {
    const detectionError = new Error('PostGIS unavailable');
    const { database, flightUpdates, transaction } = databaseDouble();
    const send = vi.fn(async () => objectBody(validIgc));
    const service = createFlightProcessingService(database as never, {
      areaDetection: { detect: vi.fn(async () => { throw detectionError; }) },
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
    });

    await expect(service.process({ ownerUserId, igcFileId, bucketKey })).rejects.toBe(detectionError);

    expect(transaction).toHaveBeenCalledOnce();
    expect(flightUpdates).toContainEqual(expect.objectContaining({ processingStatus: 'completed' }));
    expect(flightUpdates).not.toContainEqual(expect.objectContaining({ processingStatus: 'failed' }));
  });
});
