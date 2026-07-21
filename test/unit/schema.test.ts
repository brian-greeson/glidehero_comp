import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { arenas, launches } from '../../src/db/schema.js';

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

describe('Arena schema', () => {
  it('classifies Arenas and stores optional claimable-cell metadata', () => {
    const config = getTableConfig(arenas);

    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'source_id', 'name', 'country', 'state', 'city', 'location', 'altitude_meters',
      'timezone', 'area', 'external_source', 'external_id', 'arena_type', 'country_code',
      'claimable_cell_count', 'claimable_cell_size',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'arenas_area_gist_idx',
      'arenas_external_source_external_id_unique',
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      'arenas_source_id_unique',
    ]);
    expect(config.checks.map((checkConstraint) => checkConstraint.name)).toEqual([
      'arenas_country_code_iso2_check',
    ]);
  });
});
