import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { flightAreas, personalTerritories } from '../../src/db/schema.js';

describe('flight area schema', () => {
  it('defines polygon claims and spatial lookup indexes', () => {
    const config = getTableConfig(flightAreas);
    const geometry = config.columns.find((column) => column.name === 'geometry');

    expect(geometry?.getSQLType()).toBe('geometry(polygon,4326)');
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'flight_areas_flight_id_idx',
      'flight_areas_geometry_gist_idx',
    ]);
  });

  it('defines one JSONB projection per user', () => {
    const config = getTableConfig(personalTerritories);
    const userId = config.columns.find((column) => column.name === 'user_id');
    const geojson = config.columns.find((column) => column.name === 'geojson');
    const updatedAt = config.columns.find((column) => column.name === 'updated_at');

    expect(config.name).toBe('personal_territories');
    expect(userId?.primary).toBe(true);
    expect(geojson?.getSQLType()).toBe('jsonb');
    expect(updatedAt?.getSQLType()).toBe('timestamp with time zone');
  });
});
