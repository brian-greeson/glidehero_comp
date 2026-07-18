import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { launches } from '../../src/db/schema.js';

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
