import type {
  AchievementView,
  AchievementsPageModel,
  MetricView,
} from '../models.js';
import type {
  AchievementProgressCard,
  PilotAchievement,
  PilotProfileSummary,
} from '../../../services/profileService.js';

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

function earnedView(achievement: PilotAchievement): AchievementCardView {
  return {
    key: achievement.id,
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

function summaryMetrics(profile: PilotProfileSummary): MetricView[] {
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
  profile: PilotProfileSummary,
  shell: Omit<AchievementsPageModel, 'page' | 'metrics' | 'earned' | 'inProgress' | 'recentlyEarned'>,
): AchievementsPageModel {
  const earned = profile.achievements.map(earnedView);
  const inProgress = profile.achievementProgress.map(progressView);
  return {
    ...shell,
    page: 'achievements',
    metrics: summaryMetrics(profile),
    earned,
    inProgress,
    recentlyEarned: earned.slice(0, 3),
  };
}
