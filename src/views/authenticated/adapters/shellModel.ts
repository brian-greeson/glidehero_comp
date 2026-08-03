import type { AuthenticatedPage, AuthenticatedShellInput, AuthenticatedShellModel, NavigationItemView } from '../models.js';

const DEFAULT_DONATE_URL = 'https://ko-fi.com/U6U0I4TSK';
const DEFAULT_ADMIN_URL = '/admin';
const DEFAULT_LOGOUT_URL = '/logout';

const pageLabels: Record<AuthenticatedPage, string> = {
  map: 'Map',
  plan: 'Plan',
  activity: 'Activity',
  achievements: 'Achievements',
  profile: 'Profile',
  flight: 'Flight',
  group: 'Group',
};

/** Return up to two initials for the compact account avatar. */
export function initialsForDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'P';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase();
}

function navigationFor(mapHref: string): NavigationItemView[] {
  return [
    { page: 'map', label: 'Map', icon: 'map', href: mapHref },
    { page: 'plan', label: 'Plan', icon: 'plan', href: '/plan' },
    { page: 'activity', label: 'Activity', icon: 'activity', href: '/activity' },
    { page: 'achievements', label: 'Achievements', icon: 'trophy', href: '/achievements' },
    { page: 'profile', label: 'Profile', icon: 'profile', href: '/profile' },
  ];
}

/** Build the shared shell for any authenticated refreshed-app page. */
export function createAuthenticatedShellModel(input: AuthenticatedShellInput): AuthenticatedShellModel {
  const displayName = input.user.displayName.trim() || 'Pilot';
  const title = input.title ?? `${pageLabels[input.page]} · GlideHero`;

  return {
    page: input.page,
    title,
    user: {
      displayName,
      initials: initialsForDisplayName(displayName),
      isAdmin: input.isAdmin ?? false,
    },
    navigation: navigationFor(input.mapHref ?? '/following'),
    donateUrl: input.donateUrl ?? DEFAULT_DONATE_URL,
    adminUrl: input.adminUrl ?? DEFAULT_ADMIN_URL,
    logoutUrl: input.logoutUrl ?? DEFAULT_LOGOUT_URL,
    showFooter: input.showFooter ?? (input.page !== 'map' && input.page !== 'plan'),
  };
}
