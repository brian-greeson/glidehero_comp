/** Stable Release 2 achievement identifiers. Keep this list deliberately exhaustive. */
export const achievementCatalog = [
  {
    key: 'first_flight_from_launch',
    title: 'First Flight From a Launch',
    description: 'Start your first flight from a Launch Arena.',
    category: 'launch',
    kind: 'special',
  },
  ...([3, 5, 10, 25, 50] as const).map((threshold) => ({
    key: `launches_visited_${threshold}` as const,
    title: `${threshold} Launch Arenas Visited`,
    description: `Visit ${threshold} Launch Arenas.`,
    category: 'launch' as const,
    kind: 'threshold' as const,
    threshold,
  })),
  {
    key: 'complete_a_launch_arena',
    title: 'Complete a Launch Arena',
    description: 'Claim every cell in a Launch Arena.',
    category: 'launch',
    kind: 'special',
  },
  {
    key: 'most_launches_tagged_one_flight',
    title: 'Most Launches Tagged During One Flight',
    description: 'Set a personal record for distinct Launch Arenas tagged during one flight.',
    category: 'launch',
    kind: 'record',
  },
  {
    key: 'first_cells_in_general_arena',
    title: 'First Cells in a General Arena',
    description: 'Claim your first cell in a General Arena.',
    category: 'general',
    kind: 'special',
  },
  ...([1, 5, 10, 25, 50, 100, 200] as const).map((threshold) => ({
    key: `general_arenas_explored_${threshold}` as const,
    title: `${threshold} General Arena${threshold === 1 ? '' : 's'} Explored`,
    description: `Claim a cell in ${threshold} General Arena${threshold === 1 ? '' : 's'}.`,
    category: 'general' as const,
    kind: 'threshold' as const,
    threshold,
  })),
  ...([10, 25, 50, 75, 100] as const).map((threshold) => ({
    key: `general_coverage_${threshold}` as const,
    title: `${threshold}% General Arena Coverage`,
    description: `Reach ${threshold}% coverage in any General Arena.`,
    category: 'general' as const,
    kind: 'threshold' as const,
    threshold,
  })),
  ...([1, 3, 5, 10, 25, 50] as const).map((threshold) => ({
    key: `states_flown_in_${threshold}` as const,
    title: `${threshold} State${threshold === 1 ? '' : 's'} Flown in`,
    description: `Claim a cell in ${threshold} State Arena${threshold === 1 ? '' : 's'}.`,
    category: 'state' as const,
    kind: 'threshold' as const,
    threshold,
  })),
  ...([1, 3, 5, 10, 25, 50] as const).map((threshold) => ({
    key: `countries_flown_in_${threshold}` as const,
    title: `${threshold} Countr${threshold === 1 ? 'y' : 'ies'} Flown in`,
    description: `Claim a cell in ${threshold} Countr${threshold === 1 ? 'y' : 'ies'} Arena${threshold === 1 ? '' : 's'}.`,
    category: 'country' as const,
    kind: 'threshold' as const,
    threshold,
  })),
] as const;

export type AchievementDefinition = (typeof achievementCatalog)[number];
export type AchievementKey = AchievementDefinition['key'];
export type AchievementCategory = AchievementDefinition['category'];
export type AchievementKind = AchievementDefinition['kind'];

const definitionsByKey = new Map<string, AchievementDefinition>(achievementCatalog.map((definition) => [definition.key, definition]));
Object.freeze(achievementCatalog);
for (const definition of achievementCatalog) Object.freeze(definition);

export function getAchievementDefinition(key: string): AchievementDefinition {
  const definition = definitionsByKey.get(key);
  if (!definition) throw new Error(`Unknown achievement key: ${key}`);
  return definition;
}

/** Read-side catalog lookup. Legacy rows may outlive the current catalog. */
export function findAchievementDefinition(key: string): AchievementDefinition | null {
  return definitionsByKey.get(key) ?? null;
}

export function validateAchievementValue(key: string, value: number | undefined): number | undefined {
  const definition = getAchievementDefinition(key);
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`Achievement value must be a non-negative safe integer: ${key}`);
  }
  if ('threshold' in definition && value === undefined) {
    throw new Error(`Achievement requires a value: ${key}`);
  }
  if ('threshold' in definition && value !== undefined && value < definition.threshold) {
    throw new Error(`Achievement value is below its threshold: ${key}`);
  }
  if (definition.kind !== 'record' && value !== undefined && !('threshold' in definition)) {
    throw new Error(`Achievement does not accept a value: ${key}`);
  }
  if (definition.kind === 'record' && value === undefined) {
    throw new Error(`Achievement requires a value: ${key}`);
  }
  if (definition.kind === 'record' && value !== undefined && value <= 0) {
    throw new Error(`Record achievement value must be positive: ${key}`);
  }
  return value;
}
