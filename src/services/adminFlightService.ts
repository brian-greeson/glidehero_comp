import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, igcFiles, users } from '../db/schema.js';
import type { GridClaimService } from './gridClaimService.js';

export type AdminFlight = {
  id: string;
  flightDate: string | null;
  pilotEmail: string;
  originalFilename: string;
  processingStatus: 'processing' | 'completed' | 'failed';
};

export interface AdminFlightService {
  listRecentFlights(): Promise<AdminFlight[]>;
  reprocessFlight(input: { flightId: string }): ReturnType<GridClaimService['reprocess']>;
}

export function createAdminFlightService(
  database: Database,
  gridClaim: Pick<GridClaimService, 'reprocess'>,
): AdminFlightService {
  return {
    async listRecentFlights() {
      const rows = await database
        .select({
          id: flights.id,
          startedAt: flights.startedAt,
          pilotEmail: users.email,
          originalFilename: igcFiles.originalFilename,
          processingStatus: flights.processingStatus,
        })
        .from(flights)
        .innerJoin(users, eq(flights.userId, users.id))
        .innerJoin(igcFiles, eq(flights.igcFileId, igcFiles.id))
        .orderBy(desc(flights.createdAt), desc(flights.id))
        .limit(100);

      return rows.map((flight) => ({
        id: flight.id,
        flightDate: flight.startedAt?.toISOString().slice(0, 10) ?? null,
        pilotEmail: flight.pilotEmail,
        originalFilename: flight.originalFilename,
        processingStatus: flight.processingStatus,
      }));
    },
    reprocessFlight: gridClaim.reprocess,
  };
}
