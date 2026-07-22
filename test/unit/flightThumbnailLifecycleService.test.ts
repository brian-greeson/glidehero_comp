import { describe, expect, it, vi } from 'vitest';
import { createFlightThumbnailLifecycleService } from '../../src/services/flightThumbnailLifecycleService.js';

describe('flight thumbnail lifecycle service', () => {
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
