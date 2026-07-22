import { resolve } from 'node:path';
import vento from 'ventojs';
import type { ActivityEventView, AppPage, AppPageModel } from './models.js';

export type AppPageRenderer = (model: AppPageModel) => Promise<string>;
export type AppActivityFeedRenderer = (model: {
  events: ActivityEventView[];
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
}) => Promise<string>;

const templates: Record<AppPage, string> = {
  map: 'app/pages/map.vto',
  activity: 'app/pages/activity.vto',
  achievements: 'app/pages/achievements.vto',
  profile: 'app/pages/profile.vto',
};

export function createAppPageRenderer(): AppPageRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });

  return async (model) => (
    await environment.run(templates[model.page], {
      pageStylesheet: `/styles/app-ui/${model.page}.css`,
      pageScript: model.page === 'map'
        ? '/scripts/app-ui/map.js'
        : model.page === 'activity'
          ? '/scripts/app-ui/activity.js'
          : model.page === 'profile'
            ? '/scripts/app-ui/profile.js'
            : undefined,
      ...model,
    })
  ).content;
}

export function createAppActivityFeedRenderer(): AppActivityFeedRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
  return async (model) => (
    await environment.run('app/components/activityFeedFragment.vto', {
      activityLoadMoreHref: '',
      activityLoadMoreEndpoint: '',
      ...model,
    })
  ).content;
}
