import { GetObjectCommand, HeadObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { flightThumbnailKeys } from './flightThumbnailService.js';

const THUMBNAIL_URL_TTL_SECONDS = 24 * 60 * 60;

export type FlightThumbnailUrls = {
  wideUrl: string;
  squareUrl: string;
};

export interface FlightThumbnailDeliveryService {
  sign(input: { userId: string; flightId: string }): Promise<FlightThumbnailUrls | null>;
  signWideIfExists(input: { userId: string; flightId: string }): Promise<string | null>;
  signMany(inputs: readonly { userId: string; flightId: string }[]): Promise<ReadonlyMap<string, FlightThumbnailUrls>>;
}

export function createFlightThumbnailDeliveryService(options: {
  s3Client: Pick<S3, 'send'>;
  bucketName: string;
  bucketFolder: string;
  presign?: (command: GetObjectCommand, expiresIn: number) => Promise<string>;
}): FlightThumbnailDeliveryService {
  const presign = options.presign ?? ((command, expiresIn) => getSignedUrl(options.s3Client as S3, command, { expiresIn }));

  async function sign(input: { userId: string; flightId: string }): Promise<FlightThumbnailUrls | null> {
    const keys = flightThumbnailKeys(options.bucketFolder, input.userId, input.flightId);
    try {
      const [wideUrl, squareUrl] = await Promise.all([
        presign(new GetObjectCommand({ Bucket: options.bucketName, Key: keys.wideKey }), THUMBNAIL_URL_TTL_SECONDS),
        presign(new GetObjectCommand({ Bucket: options.bucketName, Key: keys.squareKey }), THUMBNAIL_URL_TTL_SECONDS),
      ]);
      return { wideUrl, squareUrl };
    } catch (error) {
      console.error('Unable to sign flight thumbnail URLs', {
        flightId: input.flightId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
  }

  return {
    sign,
    async signWideIfExists(input) {
      const { wideKey } = flightThumbnailKeys(options.bucketFolder, input.userId, input.flightId);
      try {
        await options.s3Client.send(new HeadObjectCommand({ Bucket: options.bucketName, Key: wideKey }));
        return await presign(
          new GetObjectCommand({ Bucket: options.bucketName, Key: wideKey }),
          THUMBNAIL_URL_TTL_SECONDS,
        );
      } catch (error) {
        console.error('Unable to deliver flight social preview thumbnail', {
          flightId: input.flightId,
          error: error instanceof Error ? error.message : 'unknown error',
        });
        return null;
      }
    },
    async signMany(inputs) {
      const unique = new Map(inputs.map((input) => [`${input.userId}:${input.flightId}`, input]));
      const results = await Promise.all([...unique.values()].map(async (input) => [input.flightId, await sign(input)] as const));
      return new Map(results.filter((entry): entry is readonly [string, FlightThumbnailUrls] => entry[1] !== null));
    },
  };
}
