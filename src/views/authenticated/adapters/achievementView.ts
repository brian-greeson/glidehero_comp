import type {
  AchievementView,
  AchievementsPageModel,
  MetricView,
} from '../models.js';
import type {
  AchievementProgressCard,
  PilotAchievement,
  PilotAchievementsSummary,
} from '../../../services/profileService.js';
import { resolveAchievementArtworkKey } from '../achievementArtwork.js';

/**
 * Keep the presentation mapping for achievements in one place. The profile
 * service owns the achievement semantics; this adapter only translates those
 * semantics into the refreshed page's four visual badge families.
 */
function achievementTone(input: Pick<PilotAchievement, 'achievementType' | 'achievementCategory'>): AchievementView['tone'] {
  if (input.achievementType === 'record') return 'blue';
  if (input.achievementType === 'unique_cells_milestone') return 'green';
  if (input.achievementCategory && ['launch', 'general', 'state', 'country'].includes(input.achievementCategory)) {
    return 'orange';
  }
  return 'purple';
}

function progressTone(input: Pick<AchievementProgressCard, 'key' | 'achievementType' | 'achievementCategory'>): AchievementView['tone'] {
  if (input.key === 'unique_cells') return 'green';
  if (input.achievementType === 'threshold' && input.achievementCategory && ['launch', 'general', 'state', 'country'].includes(input.achievementCategory)) {
    return 'orange';
  }
  return 'purple';
}

type AchievementCardView = AchievementView & { typeLabel: string };

export function earnedAchievementToView(achievement: PilotAchievement): AchievementCardView {
  return {
    key: achievement.id,
    artworkKey: resolveAchievementArtworkKey(achievement),
    title: achievement.title,
    description: achievement.description,
    badgeLabel: achievement.badgeLabel,
    tone: achievementTone(achievement),
    earnedDate: achievement.earnedDate,
    typeLabel: achievement.typeLabel,
  };
}

function progressView(progress: AchievementProgressCard): AchievementCardView {
  return {
    key: progress.key,
    artworkKey: resolveAchievementArtworkKey({ achievementKey: progress.key, achievementType: progress.achievementType }),
    title: progress.title,
    description: progress.currentDescription,
    badgeLabel: progress.badgeLabel,
    tone: progressTone(progress),
    current: progress.currentLabel,
    target: progress.targetLabel,
    percent: progress.progressPercent,
    typeLabel: progress.typeLabel,
  };
}

function summaryMetrics(profile: PilotAchievementsSummary): MetricView[] {
  return [
    {
      label: 'Achievements Earned',
      value: formatCount(profile.achievementCount),
      detail: 'Keep soaring!',
      icon: 'check',
      tone: 'green',
    },
    {
      label: 'In Progress',
      value: formatCount(profile.achievementProgress.length),
      detail: 'On your way!',
      icon: 'progress',
      tone: 'blue',
    },
  ];
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.trunc(value))) : '0';
}

export function createAchievementsPageModel(
  profile: PilotAchievementsSummary,
  shell: Omit<AchievementsPageModel, 'page' | 'metrics' | 'earned' | 'earnedHasExtras' | 'inProgress' | 'recentlyEarned'>,
): AchievementsPageModel {
  const visibleCategories = new Set<string>();
  const earned = profile.achievements.map((achievement) => {
    const category = achievement.achievementCategory ?? achievement.achievementType;
    const isInitiallyVisible = !visibleCategories.has(category);
    visibleCategories.add(category);
    return { ...earnedAchievementToView(achievement), isInitiallyVisible };
  });
  const inProgress = profile.achievementProgress.map(progressView);
  return {
    ...shell,
    page: 'achievements',
    metrics: summaryMetrics(profile),
    earned,
    earnedHasExtras: earned.some((achievement) => !achievement.isInitiallyVisible),
    inProgress,
    recentlyEarned: earned.slice(0, 3),
  };
}
