/** Stable presentation artwork identifiers for achievement cards. */
export type AchievementArtworkKey =
  | 'altitude-record'
  | 'arenas-touched'
  | 'cell-explorer'
  | 'champion'
  | 'collector'
  | 'community-player'
  | 'distance-record'
  | 'duration-record'
  | 'eco-pilot'
  | 'first-cell'
  | 'first-launch'
  | 'helpful-pilot'
  | 'legend'
  | 'mapper'
  | 'milestone'
  | 'photo-sharer'
  | 'precision-pilot'
  | 'streaker'
  | 'top-cell-holder';

/** Every extracted asset is registered, including artwork reserved for future achievements. */
export const achievementArtworkManifest: Readonly<Record<AchievementArtworkKey, string>> = {
  'altitude-record': '/images/app-ui/achievements/altitude-record.png',
  'arenas-touched': '/images/app-ui/achievements/arenas-touched.png',
  'cell-explorer': '/images/app-ui/achievements/cell-explorer.png',
  champion: '/images/app-ui/achievements/champion.png',
  collector: '/images/app-ui/achievements/collector.png',
  'community-player': '/images/app-ui/achievements/community-player.png',
  'distance-record': '/images/app-ui/achievements/distance-record.png',
  'duration-record': '/images/app-ui/achievements/duration-record.png',
  'eco-pilot': '/images/app-ui/achievements/eco-pilot.png',
  'first-cell': '/images/app-ui/achievements/first-cell.png',
  'first-launch': '/images/app-ui/achievements/first-launch.png',
  'helpful-pilot': '/images/app-ui/achievements/helpful-pilot.png',
  legend: '/images/app-ui/achievements/legend.png',
  mapper: '/images/app-ui/achievements/mapper.png',
  milestone: '/images/app-ui/achievements/milestone.png',
  'photo-sharer': '/images/app-ui/achievements/photo-sharer.png',
  'precision-pilot': '/images/app-ui/achievements/precision-pilot.png',
  streaker: '/images/app-ui/achievements/streaker.png',
  'top-cell-holder': '/images/app-ui/achievements/top-cell-holder.png',
};

export type AchievementArtworkIdentity = {
  /** Current catalog key or a legacy key/type. */
  achievementKey?: string;
  achievementType?: string;
};

/** Resolve stable artwork from semantic identity; unknown historical rows use a safe fallback. */
export function resolveAchievementArtworkKey(input: AchievementArtworkIdentity): AchievementArtworkKey {
  const key = input.achievementKey ?? '';
  const type = input.achievementType ?? '';
  if (key === 'unique_cells' || key === 'unique_cells_milestone' || type === 'unique_cells_milestone') return 'cell-explorer';
  if (key === 'first_flight_from_launch') return 'first-launch';
  if (key === 'complete_a_launch_arena') return 'champion';
  if (key === 'most_launches_tagged_one_flight' || key === 'personal_best_total_cells' || type === 'personal_best_total_cells') return 'distance-record';
  if (key === 'took_lead_in_arena') return 'top-cell-holder';
  if (key === 'reclaimed_lead_in_arena') return 'legend';
  if (key === 'first_cells_in_general_arena') return 'first-cell';
  if (key === 'personal_best_enclosed_cells' || type === 'personal_best_enclosed_cells') return 'mapper';
  if (key === 'launches_visited' || key.startsWith('launches_visited_')) return 'arenas-touched';
  if (key === 'general_arenas_explored' || key.startsWith('general_arenas_explored_')) return 'mapper';
  if (key === 'general_coverage' || key.startsWith('general_coverage_')) return 'mapper';
  if (key === 'states_flown_in' || key.startsWith('states_flown_in_')) return 'mapper';
  if (key === 'countries_flown_in' || key.startsWith('countries_flown_in_')) return 'collector';
  return 'milestone';
}

export function achievementArtworkSrc(key: AchievementArtworkKey): string {
  return achievementArtworkManifest[key];
}
