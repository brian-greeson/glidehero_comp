import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFlightThumbnailOverlaySvg,
  buildFlightThumbnailStaticMapUrl,
  computeFlightThumbnailExtent,
  computeFlightThumbnailViewport,
  createFlightThumbnailService,
  flightThumbnailKeys,
  projectEpsg6933,
  unprojectEpsg6933,
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

  it('uses the EPSG:6933 true-scale projection and round-trips coordinates', () => {
    const projected = projectEpsg6933(30, 10);
    const radius = 6_371_007.181;
    const k0 = Math.sqrt(3) / 2;
    expect(projected.x).toBeCloseTo(radius * k0 * (10 * Math.PI / 180), 6);
    expect(projected.y).toBeCloseTo(radius * Math.sin(Math.PI / 6) / k0, 6);
    const coordinate = unprojectEpsg6933(projected.x, projected.y);
    expect(coordinate.latitude).toBeCloseTo(30, 10);
    expect(coordinate.longitude).toBeCloseTo(10, 10);
  });

  it('fits each output to a Web Mercator viewport with its own aspect bounds', () => {
    const extent = computeFlightThumbnailExtent([{ x: 0, y: 0 }, { x: 0, y: 8 }], 500);
    const wide = computeFlightThumbnailViewport(extent, 800, 450);
    const square = computeFlightThumbnailViewport(extent, 450, 450);
    expect((wide.maxMercatorX - wide.minMercatorX) / (wide.maxMercatorY - wide.minMercatorY)).toBeCloseTo(16 / 9, 10);
    expect((square.maxMercatorX - square.minMercatorX) / (square.maxMercatorY - square.minMercatorY)).toBeCloseTo(1, 10);
    expect(buildFlightThumbnailStaticMapUrl({ extent, width: 800, height: 450, mapTilerApiKey: 'key' }))
      .not.toBe(buildFlightThumbnailStaticMapUrl({ extent, width: 450, height: 450, mapTilerApiKey: 'key' }));
  });

  it('renders direct, enclosed, and same-cell striped marker overlays', () => {
    const extent = computeFlightThumbnailExtent([{ x: 0, y: 0 }, { x: 1, y: 0 }], 500);
    const svg = buildFlightThumbnailOverlaySvg({
      directCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      enclosedCells: [{ x: 2, y: 0 }],
      startCell: { x: 0, y: 0 },
      endCell: { x: 0, y: 0 },
      extent: extent.projected,
      viewport: computeFlightThumbnailViewport(extent, 450, 450),
      cellSize: 500,
      width: 450,
      height: 450,
    });
    expect(svg).toContain('fill-opacity="0.85"');
    expect(svg).toContain('fill-opacity="0.35"');
    expect(svg).toContain('start-end-stripes');
    expect(svg).toContain('clipPath');
    expect(svg).toContain('clip-path="url(#attribution-safe-area)"');
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
    expect(putObject.mock.calls.every(([value]) => value.cacheControl === 'private, max-age=86400')).toBe(true);
    for (const [value] of putObject.mock.calls) {
      const metadata = await sharp(value.body).metadata();
      expect(metadata.format).toBe('webp');
    }
  });

  it('rejects incomplete configuration at construction', () => {
    expect(() => createFlightThumbnailService({ mapTilerApiKey: ' ', bucketName: 'flights', bucketFolder: 'folder', cellSize: 500 })).toThrow('MapTiler API key is required.');
    expect(() => createFlightThumbnailService({ mapTilerApiKey: 'key', bucketName: ' ', bucketFolder: 'folder', cellSize: 500 })).toThrow('Thumbnail bucket name is required.');
    expect(() => createFlightThumbnailService({ mapTilerApiKey: 'key', bucketName: 'flights', bucketFolder: 'folder', cellSize: 0 })).toThrow('Thumbnail cell size must be positive.');
  });
});
