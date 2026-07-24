import { asc, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, trackPoints } from '../db/schema.js';

export type MapReplayInput = { month: string; mode: 'personal' | 'competitive'; west: number; south: number; east: number; north: number; userId: string };
export type MapReplayFlight = { flightId: string; pilotUserId: string; durationMs: number; points: Array<[number, number, number]> };
export interface MapReplayService { getReplay(input: MapReplayInput): Promise<{ flights: MapReplayFlight[] }> }

export function createMapReplayService(db: Database): MapReplayService {
  return { async getReplay(input) {
    const monthStart = new Date(`${input.month}-01T00:00:00Z`);
    const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const broadStart = new Date(monthStart.getTime() - 14 * 3600000);
    const broadEnd = new Date(monthEnd.getTime() + 12 * 3600000);
    const selected = await db.execute<{ id: string; user_id: string }>(sql`
      WITH viewport_parts AS (
        SELECT ST_MakeEnvelope(${input.west}, ${input.south}, ${input.east}, ${input.north}, 4326) AS geometry
        WHERE ${input.west}::double precision <= ${input.east}::double precision
        UNION ALL SELECT ST_MakeEnvelope(${input.west}, ${input.south}, 180, ${input.north}, 4326)
        WHERE ${input.west}::double precision > ${input.east}::double precision
        UNION ALL SELECT ST_MakeEnvelope(-180, ${input.south}, ${input.east}, ${input.north}, 4326)
        WHERE ${input.west}::double precision > ${input.east}::double precision
        UNION ALL SELECT ST_MakeEnvelope(180, ${input.south}, ${input.east} + 360, ${input.north}, 4326)
        WHERE ${input.west}::double precision > ${input.east}::double precision
        UNION ALL SELECT ST_MakeEnvelope(${input.west} - 360, ${input.south}, -180, ${input.north}, 4326)
        WHERE ${input.west}::double precision > ${input.east}::double precision
      ), candidate_flights AS (
        SELECT f.flight_id, f.user_id FROM flights f
        WHERE f.processing_status='completed' AND f.started_at >= ${broadStart} AND f.started_at < ${broadEnd}
          AND (f.started_at AT TIME ZONE COALESCE(f.launch_timezone,'UTC')) >= ${input.month+'-01'}::timestamp
          AND (f.started_at AT TIME ZONE COALESCE(f.launch_timezone,'UTC')) < ${input.month+'-01'}::timestamp + interval '1 month'
          ${input.mode === 'personal' ? sql`AND f.user_id = ${input.userId}` : sql``}
      ), raw_points AS (
        SELECT tp.flight_id, tp.sequence_number, tp.longitude, tp.latitude,
          LAG(tp.longitude) OVER (PARTITION BY tp.flight_id ORDER BY tp.sequence_number) AS previous_longitude
        FROM track_points tp INNER JOIN candidate_flights candidate ON candidate.flight_id = tp.flight_id
      ), unwrapped_points AS (
        SELECT *, SUM(CASE WHEN previous_longitude IS NULL THEN 0
          WHEN longitude - previous_longitude > 180 THEN -1
          WHEN longitude - previous_longitude < -180 THEN 1 ELSE 0 END)
          OVER (PARTITION BY flight_id ORDER BY sequence_number) AS longitude_wraps
        FROM raw_points
      ), tracks AS (
        SELECT f.flight_id AS id, f.user_id,
          ST_MakeLine(ST_SetSRID(ST_MakePoint(tp.longitude + 360 * tp.longitude_wraps,tp.latitude),4326) ORDER BY tp.sequence_number) AS geom
        FROM candidate_flights f JOIN unwrapped_points tp ON tp.flight_id=f.flight_id
        GROUP BY f.flight_id, f.user_id
      ) SELECT id, user_id FROM tracks WHERE EXISTS (SELECT 1 FROM viewport_parts v WHERE ST_Intersects(tracks.geom,v.geometry))
    `);
    const ids = selected.rows.map(r => r.id); if (!ids.length) return { flights: [] };
    const points = await db.select({ flightId: trackPoints.flightId, latitude: trackPoints.latitude, longitude: trackPoints.longitude, recordedAt: trackPoints.recordedAt }).from(trackPoints).where(inArray(trackPoints.flightId, ids)).orderBy(asc(trackPoints.sequenceNumber));
    const by = new Map<string, typeof points>(); for (const p of points) by.set(p.flightId, [...(by.get(p.flightId) ?? []), p]);
    return { flights: selected.rows.flatMap(row => { const ps=by.get(row.id) ?? []; if (!ps.length) return []; const first=ps[0]!.recordedAt.getTime(); const mapped=ps.map(p=>[p.longitude,p.latitude,p.recordedAt.getTime()-first] as [number,number,number]); return [{ flightId: row.id, pilotUserId: row.user_id, durationMs: mapped.at(-1)![2], points: mapped }]; }) };
  }};
}
