import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { competitionGridClaims, flightAreas, personalTerritories, userGridClaims } from '../../src/db/schema.js';

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

describe('user grid claim schema', () => {
  it('defines cell ownership with a composite primary key and lookup indexes', () => {
    const config = getTableConfig(userGridClaims);

    expect(config.name).toBe('user_grid_claims');
    expect(config.columns.map((column) => column.name)).toEqual([
      'cell_size',
      'x',
      'y',
      'claim_flight',
      'claim_user',
      'claim_timestamp',
    ]);
    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ['cell_size', 'x', 'y'],
    ]);
    expect(config.foreignKeys.map((key) => key.onDelete)).toEqual(['cascade', 'cascade']);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'user_grid_claims_claim_user_cell_size_idx',
      'user_grid_claims_claim_flight_idx',
    ]);
  });
});

describe('competition grid claim schema', () => {
  it('retains one claim event per flight, month, and cell', () => {
    const config = getTableConfig(competitionGridClaims);

    expect(config.columns.map((column) => column.name)).toEqual([
      'competition_month',
      'cell_size',
      'x',
      'y',
      'claim_flight',
      'claim_user',
      'claim_timestamp',
    ]);
    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ['competition_month', 'cell_size', 'x', 'y', 'claim_flight'],
    ]);
    expect(config.foreignKeys.map((key) => key.onDelete)).toEqual(['cascade', 'cascade']);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'competition_grid_claims_month_cell_timestamp_idx',
      'competition_grid_claims_cell_history_idx',
      'competition_grid_claims_claim_flight_idx',
    ]);
  });
});
