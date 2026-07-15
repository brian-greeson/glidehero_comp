import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { competitionGridClaims, flights, personalGridClaims } from '../../src/db/schema.js';

describe('flight schema', () => {
  it('requires one globally unique content hash per flight', () => {
    const config = getTableConfig(flights);
    const contentHash = config.columns.find((column) => column.name === 'content_hash');

    expect(contentHash?.getSQLType()).toBe('text');
    expect(contentHash?.notNull).toBe(true);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('flights_content_hash_unique');
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
