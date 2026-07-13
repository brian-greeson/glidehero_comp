import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { personalTerritories } from '../db/schema.js';
import {
  emptyPersonalTerritoryGeoJson,
  type PersonalTerritoryGeoJson,
} from '../domain/territory/personalTerritoryGeoJson.js';

export interface PersonalTerritoryService {
  refresh(input: { userId: string }): Promise<PersonalTerritoryGeoJson>;
  get(input: { userId: string }): Promise<PersonalTerritoryGeoJson>;
}

type StoredProjection = { geojson: PersonalTerritoryGeoJson };

export function createPersonalTerritoryService(database: Database): PersonalTerritoryService {
  return {
    async refresh({ userId }) {
      return database.transaction(async (tx) => {
        const result = await tx.execute<StoredProjection>(sql`
          WITH aggregate AS (
            SELECT ST_CollectionExtract(ST_UnaryUnion(ST_Collect(fa.geometry)), 3) AS geometry
            FROM flight_areas fa
            INNER JOIN flights f ON f.flight_id = fa.flight_id
            WHERE f.user_id = ${userId}
          ),
          normalized AS (
            SELECT ST_Multi(geometry)::geometry(MultiPolygon, 4326) AS geometry
            FROM aggregate
            WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
          ),
          projection AS (
            SELECT jsonb_build_object(
              'type', 'FeatureCollection',
              'features', jsonb_build_array(jsonb_build_object(
                'type', 'Feature',
                'properties', '{}'::jsonb,
                'geometry', ST_AsGeoJSON(geometry)::jsonb
              ))
            ) AS geojson
            FROM normalized
          )
          INSERT INTO personal_territories (user_id, geojson, updated_at)
          SELECT ${userId}, geojson, NOW()
          FROM projection
          ON CONFLICT (user_id) DO UPDATE
          SET geojson = EXCLUDED.geojson, updated_at = EXCLUDED.updated_at
          RETURNING geojson
        `);
        const stored = result.rows[0];
        if (stored) return stored.geojson;

        await tx.delete(personalTerritories).where(eq(personalTerritories.userId, userId));
        return emptyPersonalTerritoryGeoJson();
      });
    },

    async get({ userId }) {
      const [territory] = await database
        .select({ geojson: personalTerritories.geojson })
        .from(personalTerritories)
        .where(eq(personalTerritories.userId, userId))
        .limit(1);
      return territory?.geojson ?? emptyPersonalTerritoryGeoJson();
    },
  };
}
