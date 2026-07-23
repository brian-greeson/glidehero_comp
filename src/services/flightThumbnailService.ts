import { PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { signMapTilerUrl } from './mapTilerCredentials.js';

const MAP_ID = 'outdoor-v4';
const STATIC_MAP_ORIGIN = 'https://api.maptiler.com';
const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const MAP_PADDING_RATIO = 0.1;
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
const ATTRIBUTION_SAFE_BOTTOM_PX = 36;
const WGS84_SEMI_MAJOR_AXIS = 6_378_137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING);
const WGS84_ECCENTRICITY = Math.sqrt(WGS84_ECCENTRICITY_SQUARED);
const EPSG6933_LATITUDE_OF_TRUE_SCALE = Math.PI / 6;
const EPSG6933_M1 = Math.cos(EPSG6933_LATITUDE_OF_TRUE_SCALE)
  / Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * Math.sin(EPSG6933_LATITUDE_OF_TRUE_SCALE) ** 2);
const EPSG6933_MAX_AUTHALIC_Q = (1 - WGS84_ECCENTRICITY_SQUARED) * (
  1 / (1 - WGS84_ECCENTRICITY_SQUARED)
  - (1 / (2 * WGS84_ECCENTRICITY)) * Math.log((1 - WGS84_ECCENTRICITY) / (1 + WGS84_ECCENTRICITY))
);
const MAPTILER_FETCH_TIMEOUT_MS = 15_000;

export type ThumbnailCell = { x: number; y: number };
export type ThumbnailTrackPoint = { latitude: number; longitude: number };
export type ThumbnailVariant = '800x450' | '450x450';

export type FlightThumbnailInput = {
  flightId: string;
  userId: string;
  directCells: readonly ThumbnailCell[];
  enclosedCells: readonly ThumbnailCell[];
  trackPoints: readonly ThumbnailTrackPoint[];
};

export type FlightThumbnailObject = {
  key: string;
  body: Uint8Array;
};

export type FlightThumbnailPutObject = (input: {
  key: string;
  body: Uint8Array;
  contentType: 'image/webp';
  cacheControl: string;
}) => Promise<void>;

export type FlightThumbnailService = {
  generate(input: FlightThumbnailInput): Promise<{ wideKey: string; squareKey: string }>;
};

export class FlightThumbnailGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FlightThumbnailGenerationError';
  }
}

export function flightThumbnailErrorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
  causeName?: string;
  causeMessage?: string;
  httpStatusCode?: number;
  errorCode?: string;
} {
  const top = error instanceof Error ? error : undefined;
  const cause = top?.cause;
  const causeRecord = cause && typeof cause === 'object' ? cause as { message?: unknown; code?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } } : undefined;
  const causeMessage = cause instanceof Error
    ? cause.message
    : typeof causeRecord?.message === 'string' ? causeRecord.message : undefined;
  const statusFromMessage = causeMessage?.match(/MapTiler returned HTTP (\d{3})\.?/)?.[1];
  const statusFromMetadata = typeof causeRecord?.$metadata?.httpStatusCode === 'number'
    ? causeRecord.$metadata.httpStatusCode
    : undefined;
  const errorCode = typeof causeRecord?.code === 'string'
    ? causeRecord.code
    : typeof causeRecord?.Code === 'string' ? causeRecord.Code : undefined;
  return {
    errorName: top?.name ?? 'UnknownError',
    errorMessage: top?.message ?? String(error),
    ...(cause instanceof Error ? { causeName: cause.name } : {}),
    ...(causeMessage ? { causeMessage } : {}),
    ...(statusFromMetadata ?? statusFromMessage ? { httpStatusCode: statusFromMetadata ?? Number(statusFromMessage) } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

export type ProjectedExtent = { minX: number; minY: number; maxX: number; maxY: number };
export type FlightThumbnailViewport = {
  min: { latitude: number; longitude: number };
  max: { latitude: number; longitude: number };
  minMercatorX: number;
  minMercatorY: number;
  maxMercatorX: number;
  maxMercatorY: number;
};

export function projectEpsg6933(latitude: number, longitude: number): { x: number; y: number } {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('EPSG:6933 latitude must be finite and within -90 to 90 degrees.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError('EPSG:6933 longitude must be finite and within -180 to 180 degrees.');
  const latitudeRadians = (latitude * Math.PI) / 180;
  const longitudeRadians = (longitude * Math.PI) / 180;
  const sineLatitude = Math.sin(latitudeRadians);
  const authalicQ = (1 - WGS84_ECCENTRICITY_SQUARED) * (
    sineLatitude / (1 - WGS84_ECCENTRICITY_SQUARED * sineLatitude ** 2)
    - (1 / (2 * WGS84_ECCENTRICITY)) * Math.log((1 - WGS84_ECCENTRICITY * sineLatitude) / (1 + WGS84_ECCENTRICITY * sineLatitude))
  );
  return {
    x: WGS84_SEMI_MAJOR_AXIS * EPSG6933_M1 * longitudeRadians,
    y: (WGS84_SEMI_MAJOR_AXIS * authalicQ) / (2 * EPSG6933_M1),
  };
}

export function unprojectEpsg6933(x: number, y: number): { latitude: number; longitude: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('EPSG:6933 coordinates must be finite.');
  const longitudeRadians = x / (WGS84_SEMI_MAJOR_AXIS * EPSG6933_M1);
  if (longitudeRadians < -Math.PI || longitudeRadians > Math.PI) throw new RangeError('EPSG:6933 longitude is outside the valid range.');
  const targetQ = (2 * EPSG6933_M1 * y) / WGS84_SEMI_MAJOR_AXIS;
  const qRatio = targetQ / EPSG6933_MAX_AUTHALIC_Q;
  if (qRatio < -1 || qRatio > 1) throw new RangeError('EPSG:6933 northing is outside the valid range.');
  if (Math.abs(1 - Math.abs(qRatio)) < 1e-14) {
    return { latitude: Math.sign(targetQ) * 90, longitude: (longitudeRadians * 180) / Math.PI };
  }
  let latitudeRadians = Math.asin(qRatio);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const sineLatitude = Math.sin(latitudeRadians);
    const cosineLatitude = Math.cos(latitudeRadians);
    const denominator = 1 - WGS84_ECCENTRICITY_SQUARED * sineLatitude ** 2;
    const authalicQ = (1 - WGS84_ECCENTRICITY_SQUARED) * (
      sineLatitude / denominator
      - (1 / (2 * WGS84_ECCENTRICITY)) * Math.log((1 - WGS84_ECCENTRICITY * sineLatitude) / (1 + WGS84_ECCENTRICITY * sineLatitude))
    );
    const derivative = 2 * (1 - WGS84_ECCENTRICITY_SQUARED) * cosineLatitude / denominator ** 2;
    const correction = (authalicQ - targetQ) / derivative;
    latitudeRadians -= correction;
    if (Math.abs(correction) < 1e-14) break;
  }
  return { latitude: (latitudeRadians * 180) / Math.PI, longitude: (longitudeRadians * 180) / Math.PI };
}

function webMercator(latitude: number, longitude: number): { x: number; y: number } {
  const clampedLatitude = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude));
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  const longitudeRadians = (longitude * Math.PI) / 180;
  return {
    x: WEB_MERCATOR_RADIUS_METERS * longitudeRadians,
    y: WEB_MERCATOR_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  };
}

function unprojectWebMercator(x: number, y: number): { latitude: number; longitude: number } {
  return {
    latitude: (Math.atan(Math.sinh(y / WEB_MERCATOR_RADIUS_METERS)) * 180) / Math.PI,
    longitude: ((x / WEB_MERCATOR_RADIUS_METERS) * 180) / Math.PI,
  };
}

function cellExtent(cells: readonly ThumbnailCell[], cellSize: number): ProjectedExtent {
  const first = cells[0];
  if (!first) throw new FlightThumbnailGenerationError('Cannot generate a flight thumbnail without claimed cells.');
  let minX = first.x * cellSize;
  let maxX = (first.x + 1) * cellSize;
  let minY = first.y * cellSize;
  let maxY = (first.y + 1) * cellSize;
  for (const cell of cells.slice(1)) {
    minX = Math.min(minX, cell.x * cellSize);
    maxX = Math.max(maxX, (cell.x + 1) * cellSize);
    minY = Math.min(minY, cell.y * cellSize);
    maxY = Math.max(maxY, (cell.y + 1) * cellSize);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const padX = Math.max(width * MAP_PADDING_RATIO, cellSize);
  const padY = Math.max(height * MAP_PADDING_RATIO, cellSize);
  return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}

export function flightThumbnailKeys(bucketFolder: string, userId: string, flightId: string): { wideKey: string; squareKey: string } {
  const folder = bucketFolder.replace(/^\/+|\/+$/g, '');
  const prefix = `${folder}/uploads/${userId}/thumbnails/${flightId}`;
  return { wideKey: `${prefix}-800x450.webp`, squareKey: `${prefix}-450x450.webp` };
}

export function computeFlightThumbnailExtent(
  cells: readonly ThumbnailCell[],
  cellSize: number,
): { min: { latitude: number; longitude: number }; max: { latitude: number; longitude: number }; projected: ProjectedExtent } {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Thumbnail cell size must be positive.');
  const projected = cellExtent(cells, cellSize);
  return {
    min: unprojectEpsg6933(projected.minX, projected.minY),
    max: unprojectEpsg6933(projected.maxX, projected.maxY),
    projected,
  };
}

function viewportFromProjected(extent: ProjectedExtent, width: number, height: number): FlightThumbnailViewport {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('Thumbnail viewport dimensions must be positive.');
  }
  const corners = [
    unprojectEpsg6933(extent.minX, extent.minY),
    unprojectEpsg6933(extent.maxX, extent.maxY),
  ].map((coordinate) => webMercator(coordinate.latitude, coordinate.longitude));
  const centerX = (corners[0]!.x + corners[1]!.x) / 2;
  const centerY = (corners[0]!.y + corners[1]!.y) / 2;
  let mercatorWidth = Math.abs(corners[1]!.x - corners[0]!.x);
  let mercatorHeight = Math.abs(corners[1]!.y - corners[0]!.y);
  const aspect = width / height;
  if (mercatorWidth / mercatorHeight < aspect) mercatorWidth = mercatorHeight * aspect;
  else mercatorHeight = mercatorWidth / aspect;
  const minMercatorX = centerX - mercatorWidth / 2;
  const maxMercatorX = centerX + mercatorWidth / 2;
  const minMercatorY = centerY - mercatorHeight / 2;
  const maxMercatorY = centerY + mercatorHeight / 2;
  return {
    min: unprojectWebMercator(minMercatorX, minMercatorY),
    max: unprojectWebMercator(maxMercatorX, maxMercatorY),
    minMercatorX,
    minMercatorY,
    maxMercatorX,
    maxMercatorY,
  };
}

export function computeFlightThumbnailViewport(
  extent: ReturnType<typeof computeFlightThumbnailExtent>,
  width: number,
  height: number,
): FlightThumbnailViewport {
  return viewportFromProjected(extent.projected, width, height);
}

export function buildFlightThumbnailStaticMapUrl(input: {
  extent: ReturnType<typeof computeFlightThumbnailExtent>;
  width: number;
  height: number;
  mapTilerCredentials: string;
  viewport?: FlightThumbnailViewport;
}): string {
  const { min, max } = input.viewport ?? computeFlightThumbnailViewport(input.extent, input.width, input.height);
  const bounds = [min.longitude, min.latitude, max.longitude, max.latitude].map((value) => value.toFixed(6)).join(',');
  return signMapTilerUrl(
    `${STATIC_MAP_ORIGIN}/maps/${MAP_ID}/static/${bounds}/${input.width}x${input.height}.png?padding=0`,
    input.mapTilerCredentials,
  );
}

function cellKey(cell: ThumbnailCell): string {
  return `${cell.x}:${cell.y}`;
}

function cellForPoint(point: ThumbnailTrackPoint, cellSize: number): ThumbnailCell {
  const projected = projectEpsg6933(point.latitude, point.longitude);
  return { x: Math.floor(projected.x / cellSize), y: Math.floor(projected.y / cellSize) };
}

function markerCell(point: ThumbnailTrackPoint, directCells: readonly ThumbnailCell[], cellSize: number): ThumbnailCell {
  const candidate = cellForPoint(point, cellSize);
  if (directCells.some((cell) => cell.x === candidate.x && cell.y === candidate.y)) return candidate;
  const projected = projectEpsg6933(point.latitude, point.longitude);
  let nearest = directCells[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const cell of directCells) {
    const centerX = (cell.x + 0.5) * cellSize;
    const centerY = (cell.y + 0.5) * cellSize;
    const distance = (centerX - projected.x) ** 2 + (centerY - projected.y) ** 2;
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  }
  if (!nearest) throw new FlightThumbnailGenerationError('Cannot place flight thumbnail start or end marker.');
  return nearest;
}

function pixelForMercator(point: { x: number; y: number }, viewport: FlightThumbnailViewport, width: number, height: number): { x: number; y: number } {
  return {
    x: ((point.x - viewport.minMercatorX) / (viewport.maxMercatorX - viewport.minMercatorX)) * width,
    y: ((viewport.maxMercatorY - point.y) / (viewport.maxMercatorY - viewport.minMercatorY)) * height,
  };
}

function cellPolygon(cell: ThumbnailCell, viewport: FlightThumbnailViewport, cellSize: number, width: number, height: number): string {
  const corners = [
    { x: cell.x * cellSize, y: cell.y * cellSize },
    { x: (cell.x + 1) * cellSize, y: cell.y * cellSize },
    { x: (cell.x + 1) * cellSize, y: (cell.y + 1) * cellSize },
    { x: cell.x * cellSize, y: (cell.y + 1) * cellSize },
  ].map((corner) => {
    const coordinate = unprojectEpsg6933(corner.x, corner.y);
    return pixelForMercator(webMercator(coordinate.latitude, coordinate.longitude), viewport, width, height);
  });
  return corners.map((corner) => `${corner.x.toFixed(2)},${corner.y.toFixed(2)}`).join(' ');
}

export function buildFlightThumbnailOverlaySvg(input: {
  directCells: readonly ThumbnailCell[];
  enclosedCells: readonly ThumbnailCell[];
  startCell: ThumbnailCell;
  endCell: ThumbnailCell;
  extent: ProjectedExtent;
  viewport?: FlightThumbnailViewport;
  cellSize: number;
  width: number;
  height: number;
}): string {
  const viewport = input.viewport ?? viewportFromProjected(input.extent, input.width, input.height);
  const direct = new Map(input.directCells.map((cell) => [cellKey(cell), cell]));
  const enclosed = input.enclosedCells.filter((cell) => !direct.has(cellKey(cell)));
  const sameCell = cellKey(input.startCell) === cellKey(input.endCell);
  const markerPattern = sameCell
    ? '<pattern id="start-end-stripes" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="10" height="10" fill="#d71920"/><rect width="5" height="10" fill="#24a148"/></pattern>'
    : '';
  const cells = [
    ...enclosed.map((cell) => `<polygon points="${cellPolygon(cell, viewport, input.cellSize, input.width, input.height)}" fill="#d71920" fill-opacity="0.35" stroke="#7f1d1d" stroke-opacity="0.6" stroke-width="1"/>`),
    ...[...direct.values()].map((cell) => `<polygon points="${cellPolygon(cell, viewport, input.cellSize, input.width, input.height)}" fill="#d71920" fill-opacity="0.85" stroke="#7f1d1d" stroke-opacity="0.7" stroke-width="1"/>`),
  ].join('');
  const marker = `<polygon points="${cellPolygon(input.startCell, viewport, input.cellSize, input.width, input.height)}" fill="${sameCell ? 'url(#start-end-stripes)' : '#24a148'}" stroke="#173b1e" stroke-width="1.5"/><polygon points="${cellPolygon(input.endCell, viewport, input.cellSize, input.width, input.height)}" fill="${sameCell ? 'url(#start-end-stripes)' : '#d71920'}" stroke="#641218" stroke-width="1.5"/>`;
  const safeHeight = Math.max(0, input.height - ATTRIBUTION_SAFE_BOTTOM_PX);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><defs>${markerPattern}<clipPath id="attribution-safe-area"><rect x="0" y="0" width="${input.width}" height="${safeHeight}"/></clipPath></defs><g clip-path="url(#attribution-safe-area)">${cells}${marker}</g></svg>`;
}

async function defaultFetchImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(MAPTILER_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`MapTiler returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export function createFlightThumbnailService(options: {
  mapTilerCredentials: string;
  bucketName: string;
  bucketFolder: string;
  cellSize: number;
  s3Client?: Pick<S3, 'send'>;
  fetchImage?: (url: string) => Promise<Uint8Array>;
  putObject?: FlightThumbnailPutObject;
}): FlightThumbnailService {
  if (!options.mapTilerCredentials.trim()) throw new RangeError('MapTiler credentials are required.');
  if (!options.bucketName.trim()) throw new RangeError('Thumbnail bucket name is required.');
  if (!options.bucketFolder.replace(/^\/+|\/+$/g, '').trim()) throw new RangeError('Thumbnail bucket folder is required.');
  if (!Number.isFinite(options.cellSize) || options.cellSize <= 0) throw new RangeError('Thumbnail cell size must be positive.');
  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const putObject: FlightThumbnailPutObject = options.putObject ?? (async (input) => {
    if (!options.s3Client) throw new FlightThumbnailGenerationError('Thumbnail object storage is not configured.');
    await options.s3Client.send(new PutObjectCommand({
      Bucket: options.bucketName,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }));
  });

  async function render(input: FlightThumbnailInput, variant: ThumbnailVariant, extent: ReturnType<typeof computeFlightThumbnailExtent>, startCell: ThumbnailCell, endCell: ThumbnailCell): Promise<Uint8Array> {
    const [width, height] = variant.split('x').map(Number) as [number, number];
    const viewport = computeFlightThumbnailViewport(extent, width, height);
    const url = buildFlightThumbnailStaticMapUrl({ extent, width, height, mapTilerCredentials: options.mapTilerCredentials, viewport });
    let baseImage: Uint8Array;
    try {
      baseImage = await fetchImage(url);
    } catch (error) {
      throw new FlightThumbnailGenerationError('Unable to fetch the MapTiler base image for this flight thumbnail.', { cause: error });
    }
    const overlay = buildFlightThumbnailOverlaySvg({
      directCells: input.directCells,
      enclosedCells: input.enclosedCells,
      startCell,
      endCell,
      extent: extent.projected,
      viewport,
      cellSize: options.cellSize,
      width,
      height,
    });
    try {
      return await sharp(baseImage).resize(width, height, { fit: 'fill' }).composite([{ input: Buffer.from(overlay), blend: 'over' }]).webp().toBuffer();
    } catch (error) {
      throw new FlightThumbnailGenerationError('Unable to composite the flight thumbnail image.', { cause: error });
    }
  }

  return {
    async generate(input) {
      if (!input.flightId.trim() || !input.userId.trim()) throw new FlightThumbnailGenerationError('Flight and user identifiers are required for a thumbnail.');
      const directCells = [...new Map(input.directCells.map((cell) => [cellKey(cell), cell])).values()];
      const enclosedCells = [...new Map(input.enclosedCells.map((cell) => [cellKey(cell), cell])).values()];
      if (!directCells.length && !enclosedCells.length) throw new FlightThumbnailGenerationError('Cannot generate a flight thumbnail without claimed cells.');
      if (!input.trackPoints.length) throw new FlightThumbnailGenerationError('Cannot generate a flight thumbnail without recorded track points.');
      const extent = computeFlightThumbnailExtent([...directCells, ...enclosedCells], options.cellSize);
      const startCell = markerCell(input.trackPoints[0]!, directCells, options.cellSize);
      const endCell = markerCell(input.trackPoints[input.trackPoints.length - 1]!, directCells, options.cellSize);
      const [wide, square] = await Promise.all([
        render({ ...input, directCells, enclosedCells }, '800x450', extent, startCell, endCell),
        render({ ...input, directCells, enclosedCells }, '450x450', extent, startCell, endCell),
      ]);
      const keys = flightThumbnailKeys(options.bucketFolder, input.userId, input.flightId);
      try {
        await putObject({ key: keys.wideKey, body: wide, contentType: 'image/webp', cacheControl: 'private, max-age=86400' });
        await putObject({ key: keys.squareKey, body: square, contentType: 'image/webp', cacheControl: 'private, max-age=86400' });
      } catch (error) {
        throw new FlightThumbnailGenerationError('Unable to store the generated flight thumbnails.', { cause: error });
      }
      return keys;
    },
  };
}
