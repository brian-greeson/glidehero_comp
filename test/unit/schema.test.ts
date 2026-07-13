import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { flightAreas } from '../../src/db/schema.js';

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
});
