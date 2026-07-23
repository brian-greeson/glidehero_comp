import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { arenaCurrentLeaders, arenaLeadershipEvents, arenaLeadershipStates, arenas, launches, userArenaProgress } from '../../src/db/schema.js';

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
  it('classifies Arenas and stores optional claimable-cell counts', () => {
    const config = getTableConfig(arenas);

    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'source_id', 'name', 'country', 'state', 'city', 'location', 'altitude_meters',
      'timezone', 'area', 'external_source', 'external_id', 'arena_type', 'country_code',
      'claimable_cell_count',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'arenas_area_gist_idx',
      'arenas_external_source_external_id_unique',
      'arenas_arena_type_external_id_state_country_unique',
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      'arenas_source_id_unique',
      'arenas_id_arena_type_unique',
    ]);
    expect(config.checks.map((checkConstraint) => checkConstraint.name)).toEqual([
      'arenas_country_code_iso2_check',
      'arenas_state_country_external_id_required',
    ]);
  });
});

describe('Arena leadership schema', () => {
  it('stores one eligible Arena snapshot with nonnegative rank counts', () => {
    const config = getTableConfig(arenaLeadershipStates);

    expect(config.columns.map((column) => column.name)).toEqual([
      'arena_id', 'arena_type', 'leading_cell_count', 'next_rank_cell_count',
      'last_reconciled_at', 'last_reconciliation_key', 'last_claim_timestamp',
      'last_claim_source_flight_id',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'arena_leadership_states_arena_type_idx',
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      'arena_leadership_states_eligible_arena_type_check',
      'arena_leadership_states_leading_cell_count_nonnegative',
      'arena_leadership_states_next_rank_cell_count_nonnegative',
    ]);
  });

  it('supports joint current leaders and deterministic transition identities', () => {
    const currentLeaders = getTableConfig(arenaCurrentLeaders);
    expect(currentLeaders.primaryKeys).toHaveLength(1);
    expect(currentLeaders.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(['arena_id', 'user_id']);
    expect(currentLeaders.checks.map((constraint) => constraint.name)).toEqual([
      'arena_current_leaders_cells_claimed_positive',
    ]);

    const events = getTableConfig(arenaLeadershipEvents);
    expect(events.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      'arena_leadership_events_event_key_unique',
    ]);
    expect(events.indexes.map((index) => index.config.name)).toEqual([
      'arena_leadership_events_arena_id_claim_timestamp_idx',
      'arena_leadership_events_arena_id_user_id_claim_timestamp_idx',
      'arena_leadership_events_source_flight_id_idx',
    ]);
  });
});

describe('User Arena progress schema', () => {
  it('stores one nonnegative progress projection per user and Arena', () => {
    const config = getTableConfig(userArenaProgress);

    expect(config.columns.map((column) => column.name)).toEqual([
      'user_id', 'arena_id', 'claimed_cell_count', 'visited', 'updated_at',
    ]);
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(['user_id', 'arena_id']);
    expect(config.columns.find((column) => column.name === 'claimed_cell_count')).toMatchObject({ notNull: true, default: 0 });
    expect(config.columns.find((column) => column.name === 'visited')).toMatchObject({ notNull: true, default: false });
    expect(config.columns.find((column) => column.name === 'updated_at')).toMatchObject({ notNull: true, hasDefault: true });
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      'user_arena_progress_claimed_cell_count_nonnegative',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'user_arena_progress_arena_id_claimed_cell_count_idx',
    ]);

    expect(config.foreignKeys).toHaveLength(2);
    expect(config.foreignKeys.every((foreignKey) => foreignKey.onDelete === 'cascade')).toBe(true);
  });
});
