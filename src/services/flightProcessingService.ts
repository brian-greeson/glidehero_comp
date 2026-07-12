import { GetObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, trackPoints } from '../db/schema.js';
import { IgcParseError } from '../domain/igc/errors.js';
import { parseIgcFlight } from '../domain/igc/parseIgcFlight.js';

export type FlightProcessingOutcome =
  | { status: 'completed'; flightId: string }
  | { status: 'failed'; flightId: string; message: string };

export interface FlightProcessingService {
  process(input: { ownerUserId: string; igcFileId: string; bucketKey: string }): Promise<FlightProcessingOutcome>;
}

function parserMessage(error: IgcParseError): string {
  if (error.code === 'insufficient_fixes') return 'This IGC file has no valid GPS fixes to process.';
  if (error.code === 'missing_date' || error.code === 'invalid_date') {
    return 'This IGC file is missing a usable flight date.';
  }
  return 'This IGC file is not a valid flight track.';
}

export function createFlightProcessingService(
  database: Database,
  options: { s3Client: Pick<S3, 'send'>; bucketName: string },
): FlightProcessingService {
  async function fail(flightId: string, message: string): Promise<FlightProcessingOutcome> {
    await database
      .update(flights)
      .set({ processingStatus: 'failed', processingError: message })
      .where(eq(flights.id, flightId));
    return { status: 'failed', flightId, message };
  }

  return {
    async process(input) {
      const [flight] = await database
        .insert(flights)
        .values({ userId: input.ownerUserId, igcFileId: input.igcFileId })
        .returning({ id: flights.id });
      if (!flight) throw new Error('Flight insert returned no row.');

      let source: string;
      try {
        const object = await options.s3Client.send(
          new GetObjectCommand({ Bucket: options.bucketName, Key: input.bucketKey }),
        );
        if (!object.Body) {
          return fail(flight.id, 'We could not read your uploaded IGC file. Please upload it again.');
        }
        source = await object.Body.transformToString();
      } catch (error) {
        console.error('Unable to read uploaded IGC file', error);
        return fail(flight.id, 'We could not read your uploaded IGC file. Please upload it again.');
      }

      let parsed;
      try {
        parsed = parseIgcFlight(source);
      } catch (error) {
        return fail(
          flight.id,
          error instanceof IgcParseError ? parserMessage(error) : 'This IGC file is not a valid flight track.',
        );
      }

      await database.transaction(async (tx) => {
        await tx.insert(trackPoints).values(parsed.points.map((point) => ({ flightId: flight.id, ...point })));
        await tx
          .update(flights)
          .set({
            processingStatus: 'completed',
            processingError: null,
            startedAt: parsed.startedAt,
            endedAt: parsed.endedAt,
            durationSeconds: parsed.durationSeconds,
            distanceMeters: parsed.distanceMeters,
            launchLatitude: parsed.launchLatitude,
            launchLongitude: parsed.launchLongitude,
          })
          .where(eq(flights.id, flight.id));
      });

      return { status: 'completed', flightId: flight.id };
    },
  };
}
