import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { achievementRecordEvents, achievementRecords, achievements } from '../../src/db/schema.js';

describe('achievement persistence schema', () => {
  it('keeps one-time awards unique per user and key', () => {
    const config = getTableConfig(achievements);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('achievements_user_id_achievement_key_unique');
  });

  it('stores the current personal best and immutable event history', () => {
    const recordConfig = getTableConfig(achievementRecords);
    expect(recordConfig.columns.map((column) => column.name)).toEqual([
      'id', 'user_id', 'record_key', 'best_value', 'source_flight_id', 'earned_at', 'details', 'created_at', 'updated_at',
    ]);
    expect(recordConfig.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      'achievement_records_user_id_record_key_unique',
    ]);
    expect(recordConfig.checks.map((constraint) => constraint.name)).toEqual(['achievement_records_best_value_nonnegative']);

    const eventConfig = getTableConfig(achievementRecordEvents);
    expect(eventConfig.columns.map((column) => column.name)).toEqual([
      'id', 'record_id', 'user_id', 'source_flight_id', 'value', 'earned_at', 'details', 'created_at',
    ]);
    expect(eventConfig.checks.map((constraint) => constraint.name)).toEqual(['achievement_record_events_value_nonnegative']);
  });
});

