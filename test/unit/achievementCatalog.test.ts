import { describe, expect, it } from 'vitest';
import {
  achievementCatalog,
  getAchievementDefinition,
  validateAchievementValue,
} from '../../src/domain/achievement/catalog.js';

describe('Release 2 achievement catalog', () => {
  it('contains exactly the approved keys and thresholds', () => {
    expect(achievementCatalog.map((definition) => definition.key)).toEqual([
      'first_flight_from_launch',
      'launches_visited_3', 'launches_visited_5', 'launches_visited_10', 'launches_visited_25', 'launches_visited_50',
      'complete_a_launch_arena',
      'most_launches_tagged_one_flight',
      'first_cells_in_general_arena',
      'general_arenas_explored_1', 'general_arenas_explored_5', 'general_arenas_explored_10',
      'general_arenas_explored_25', 'general_arenas_explored_50', 'general_arenas_explored_100', 'general_arenas_explored_200',
      'general_coverage_10', 'general_coverage_25', 'general_coverage_50', 'general_coverage_75', 'general_coverage_100',
      'states_flown_in_1', 'states_flown_in_3', 'states_flown_in_5', 'states_flown_in_10', 'states_flown_in_25', 'states_flown_in_50',
      'countries_flown_in_1', 'countries_flown_in_3', 'countries_flown_in_5', 'countries_flown_in_10', 'countries_flown_in_25', 'countries_flown_in_50',
    ]);
    expect(achievementCatalog.filter((definition) => definition.kind === 'threshold').map((definition) => definition.threshold)).toEqual([
      3, 5, 10, 25, 50,
      1, 5, 10, 25, 50, 100, 200,
      10, 25, 50, 75, 100,
      1, 3, 5, 10, 25, 50,
      1, 3, 5, 10, 25, 50,
    ]);
    expect(achievementCatalog.some((definition) => definition.key.includes('completed'))).toBe(false);
    expect(achievementCatalog.some((definition) => definition.key.includes('state_coverage'))).toBe(false);
    expect(achievementCatalog.some((definition) => definition.key.includes('country_coverage'))).toBe(false);
  });

  it('rejects unknown keys and invalid or missing values', () => {
    expect(() => getAchievementDefinition('not-an-achievement')).toThrow('Unknown achievement key');
    expect(() => validateAchievementValue('launches_visited_3', undefined)).toThrow('requires a value');
    expect(() => validateAchievementValue('launches_visited_3', 2)).toThrow('below its threshold');
    expect(() => validateAchievementValue('launches_visited_3', -1)).toThrow('non-negative');
    expect(() => validateAchievementValue('complete_a_launch_arena', 1)).toThrow('does not accept a value');
    expect(() => validateAchievementValue('most_launches_tagged_one_flight', undefined)).toThrow('requires a value');
    expect(validateAchievementValue('launches_visited_3', 3)).toBe(3);
  });

  it('uses singular copy for one-item milestones and cannot be mutated at runtime', () => {
    expect(getAchievementDefinition('general_arenas_explored_1')).toMatchObject({
      title: '1 General Arena Explored',
      description: 'Claim a cell in 1 General Arena.',
    });
    expect(getAchievementDefinition('states_flown_in_1')).toMatchObject({
      title: '1 State Flown in',
      description: 'Claim a cell in 1 State Arena.',
    });
    expect(getAchievementDefinition('countries_flown_in_1')).toMatchObject({
      title: '1 Country Flown in',
      description: 'Claim a cell in 1 Country Arena.',
    });
    expect(Object.isFrozen(achievementCatalog)).toBe(true);
    expect(Object.isFrozen(achievementCatalog[0])).toBe(true);
  });
});
