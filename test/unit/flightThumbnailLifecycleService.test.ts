import { describe, expect, it, vi } from 'vitest';
import { createFlightThumbnailLifecycleService } from '../../src/services/flightThumbnailLifecycleService.js';
import type { FlightThumbnailInput } from '../../src/services/flightThumbnailService.js';

describe('flight thumbnail lifecycle service', () => {
  function databaseForEndpoints(startPoint: { sequenceNumber: number; latitude: number; longitude: number }, endPoint: { sequenceNumber: number; latitude: number; longitude: number }) {
    let selectCall = 0;
    const database = {
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return { from: () => ({ where: () => ({ limit: async () => [{ userId: 'user-1' }] }) }) };
        }
        const point = selectCall === 2 ? startPoint : endPoint;
        return { from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [point] }) }) }) };
      }),
      execute: vi.fn(async () => ({ rows: [{ x: 1, y: 2, kind: 'direct' as const }] })),
    };
    return database;
  }

  it('loads only first and last track rows in sequence order for a multi-point flight', async () => {
    const generate = vi.fn<(input: FlightThumbnailInput) => Promise<{ wideKey: string; squareKey: string }>>(async () => ({ wideKey: 'wide', squareKey: 'square' }));
    const database = databaseForEndpoints(
      { sequenceNumber: 2, latitude: 40, longitude: -105 },
      { sequenceNumber: 99, latitude: 41, longitude: -104 },
    );
    const lifecycle = createFlightThumbnailLifecycleService(database as never, { generate }, {
      cellSize: 500,
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
    });

    await lifecycle.generateForFlight('flight-1');

    expect(database.select).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[0]?.[0].trackPoints).toEqual([
      { sequenceNumber: 2, latitude: 40, longitude: -105 },
      { sequenceNumber: 99, latitude: 41, longitude: -104 },
    ]);
  });

  it('returns one endpoint when the flight has a single track row', async () => {
    const generate = vi.fn<(input: FlightThumbnailInput) => Promise<{ wideKey: string; squareKey: string }>>(async () => ({ wideKey: 'wide', squareKey: 'square' }));
    const point = { sequenceNumber: 7, latitude: 40, longitude: -105 };
    const database = databaseForEndpoints(point, point);
    const lifecycle = createFlightThumbnailLifecycleService(database as never, { generate }, {
      cellSize: 500,
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
    });

    await lifecycle.generateForFlight('flight-1');

    expect(generate.mock.calls[0]?.[0].trackPoints).toEqual([point]);
  });

  it('loads an injected flight projection and delegates generation', async () => {
    const generate = vi.fn(async () => ({ wideKey: 'wide', squareKey: 'square' }));
    const input = {
      flightId: 'flight-1',
      userId: 'user-1',
      directCells: [{ x: 1, y: 2 }],
      enclosedCells: [{ x: 2, y: 2 }],
      trackPoints: [{ latitude: 40, longitude: -105 }],
    };
    const lifecycle = createFlightThumbnailLifecycleService({} as never, { generate }, {
      cellSize: 500,
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
      loadInput: vi.fn(async () => input),
    });

    await lifecycle.generateForFlight('flight-1');

    expect(generate).toHaveBeenCalledWith(input);
  });

  it('attempts both deterministic thumbnail deletions even when one delete fails', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('temporary object-store failure'))
      .mockResolvedValueOnce({});
    const lifecycle = createFlightThumbnailLifecycleService({} as never, { generate: vi.fn() }, {
      cellSize: 500,
      s3Client: { send } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
    });

    await expect(lifecycle.deleteForFlight({ userId: 'user-1', flightId: 'flight-1' })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([command]) => command.input.Key)).toEqual([
      'glidehero-test/uploads/user-1/thumbnails/flight-1-800x450.webp',
      'glidehero-test/uploads/user-1/thumbnails/flight-1-450x450.webp',
    ]);
  });
});
