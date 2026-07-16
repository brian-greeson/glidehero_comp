import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { competitionGridClaims, flights, launchAreaCells, launchAreas, launches, personalGridClaims } from '../../src/db/schema.js';

describe('flight schema', () => {
  it('requires one globally unique content hash per flight', () => {
    const config = getTableConfig(flights);
    const contentHash = config.columns.find((column) => column.name === 'content_hash');

    expect(contentHash?.getSQLType()).toBe('text');
    expect(contentHash?.notNull).toBe(true);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('flights_content_hash_unique');
  });
});

describe('launch schema', () => {
  it('preserves the source launch fields and lookup indexes', () => {
    const config = getTableConfig(launches);

    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'name', 'longitude', 'latitude', 'country', 'state', 'city', 'description',
      'xc_by_month', 'timezone_offset', 'xc_by_year', 'rank', 'elevation',
      'rank_1', 'rank_2', 'rank_3', 'rank_4', 'rank_5', 'rank_6', 'rank_7',
      'rank_8', 'rank_9', 'rank_10', 'rank_11', 'rank_12', 'xcontest_launch_site',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'launches_name_idx',
      'launches_country_idx',
      'launches_state_idx',
      'launches_xcontest_launch_site_idx',
    ]);
  });
});

describe('launch area schema', () => {
  it('stores durable metadata and an optional projected area', () => {
    const config = getTableConfig(launchAreas);

    expect(config.columns.map((column) => [column.name, column.getSQLType(), column.notNull])).toEqual([
      ['id', 'uuid', true],
      ['source_id', 'bigint', true],
      ['name', 'text', true],
      ['country', 'text', true],
      ['state', 'text', true],
      ['city', 'text', true],
      ['location', 'geometry(point,4326)', true],
      ['altitude_meters', 'integer', true],
      ['timezone', 'text', true],
      ['area', 'geometry(multipolygon,6933)', false],
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('launch_areas_source_id_unique');
    expect(config.indexes.map((index) => [index.config.name, index.config.method, Boolean(index.config.where)])).toEqual([
      ['launch_areas_area_gist_idx', 'gist', true],
    ]);
  });

  it('stores exact grid membership with area-first and cell-first indexes', () => {
    const config = getTableConfig(launchAreaCells);

    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ['launch_area_id', 'cell_size', 'x', 'y'],
    ]);
    expect(config.foreignKeys.map((key) => key.onDelete)).toEqual(['cascade']);
    expect(config.indexes.map((index) => index.config.name)).toEqual(['launch_area_cells_cell_idx']);
  });
});

describe('personal grid claim schema', () => {
  it('retains each pilot and flight contribution with a composite primary key and lookup indexes', () => {
    const config = getTableConfig(personalGridClaims);

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
      ['claim_user', 'cell_size', 'x', 'y', 'claim_flight'],
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
