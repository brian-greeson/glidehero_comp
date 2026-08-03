import { resolve } from 'node:path';
import vento from 'ventojs';
import type { ActivityEventView, AuthenticatedPage, AuthenticatedPageModel } from './models.js';

export type AuthenticatedPageRenderer = (model: AuthenticatedPageModel) => Promise<string>;
export type AuthenticatedActivityFeedRenderer = (model: {
  events: ActivityEventView[];
  activityLoadMoreHref?: string;
  activityLoadMoreEndpoint?: string;
}) => Promise<string>;

const templates: Record<AuthenticatedPage, string> = {
  map: 'authenticated/pages/map.vto',
  plan: 'authenticated/pages/plan.vto',
  activity: 'authenticated/pages/activity.vto',
  achievements: 'authenticated/pages/achievements.vto',
  profile: 'authenticated/pages/profile.vto',
  flight: 'authenticated/pages/flight.vto',
  group: 'authenticated/pages/group.vto',
};

export function createAuthenticatedPageRenderer(): AuthenticatedPageRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });

  return async (model) => (
    await environment.run(templates[model.page], {
      isGuest: false,
      pageStylesheet: `/styles/app-ui/${model.page}.css`,
      pageScript: model.page === 'map'
        ? '/scripts/app-ui/map.js'
        : model.page === 'plan'
          ? '/scripts/app-ui/plan.js'
        : model.page === 'activity'
          ? '/scripts/app-ui/activity.js'
          : model.page === 'profile'
            ? '/scripts/app-ui/profile.js'
            : model.page === 'achievements'
              ? '/scripts/app-ui/achievements.js'
              : model.page === 'flight'
                ? '/scripts/app-ui/flight.js'
              : model.page === 'group'
                ? '/scripts/app-ui/group.js'
            : undefined,
      ...model,
    })
  ).content;
}

export function createAuthenticatedActivityFeedRenderer(): AuthenticatedActivityFeedRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });
  return async (model) => (
    await environment.run('authenticated/components/activityFeedFragment.vto', {
      activityLoadMoreHref: '',
      activityLoadMoreEndpoint: '',
      ...model,
    })
  ).content;
}
