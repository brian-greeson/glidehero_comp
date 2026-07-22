import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFlightThumbnailOverlaySvg,
  buildFlightThumbnailStaticMapUrl,
  computeFlightThumbnailExtent,
  createFlightThumbnailService,
  flightThumbnailKeys,
  type FlightThumbnailPutObject,
} from '../../src/services/flightThumbnailService.js';

describe('flight thumbnail service', () => {
  it('builds deterministic object keys and a padded outdoor-v4 static map URL', () => {
    const keys = flightThumbnailKeys('/glidehero-dev/', 'user-1', 'flight-1');
    expect(keys).toEqual({
      wideKey: 'glidehero-dev/uploads/user-1/thumbnails/flight-1-800x450.webp',
      squareKey: 'glidehero-dev/uploads/user-1/thumbnails/flight-1-450x450.webp',
    });
    const extent = computeFlightThumbnailExtent([{ x: 10, y: -2 }], 500);
    expect(extent.projected.maxX - extent.projected.minX).toBe(1_500);
    expect(extent.projected.maxY - extent.projected.minY).toBe(1_500);
    expect(buildFlightThumbnailStaticMapUrl({ extent, width: 800, height: 450, mapTilerApiKey: 'secret-key' }))
      .toMatch(/^https:\/\/api\.maptiler\.com\/maps\/outdoor-v4\/static\/-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+\/800x450\.png\?key=secret-key$/);
  });

  it('renders direct, enclosed, and same-cell striped marker overlays', () => {
    const extent = computeFlightThumbnailExtent([{ x: 0, y: 0 }, { x: 1, y: 0 }], 500);
    const svg = buildFlightThumbnailOverlaySvg({
      directCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      enclosedCells: [{ x: 2, y: 0 }],
      startCell: { x: 0, y: 0 },
      endCell: { x: 0, y: 0 },
      extent: extent.projected,
      cellSize: 500,
      width: 450,
      height: 450,
    });
    expect(svg).toContain('fill-opacity="0.85"');
    expect(svg).toContain('fill-opacity="0.35"');
    expect(svg).toContain('start-end-stripes');
  });

  it('fetches, composites, and stores both WebP variants without exposing delivery details', async () => {
    const base = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#d4ddd8' } }).png().toBuffer();
    const fetchImage = vi.fn<(url: string) => Promise<Uint8Array>>(async () => new Uint8Array(base));
    const putObject = vi.fn<FlightThumbnailPutObject>(async () => undefined);
    const service = createFlightThumbnailService({
      mapTilerApiKey: 'maptiler-test-key',
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
      cellSize: 500,
      fetchImage,
      putObject,
    });

    const result = await service.generate({
      flightId: 'flight-1',
      userId: 'user-1',
      directCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      enclosedCells: [{ x: 0, y: 1 }],
      trackPoints: [{ latitude: 0.001, longitude: 0.001 }, { latitude: 0.003, longitude: 0.006 }],
    });

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(fetchImage.mock.calls[0]?.[0]).toContain('/maps/outdoor-v4/static/');
    expect(fetchImage.mock.calls[0]?.[0]).not.toContain('undefined');
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(putObject.mock.calls.map(([value]) => value.key)).toEqual([result.wideKey, result.squareKey]);
    expect(putObject.mock.calls.every(([value]) => value.contentType === 'image/webp')).toBe(true);
    for (const [value] of putObject.mock.calls) {
      const metadata = await sharp(value.body).metadata();
      expect(metadata.format).toBe('webp');
    }
  });
});
