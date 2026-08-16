import type { AuthenticatedPage, AuthenticatedShellInput, AuthenticatedShellModel, NavigationItemView, PrimaryNavigationPage } from '../models.js';

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
  const mapDestination = mapHref.startsWith('/personal') ? '/following' : mapHref;
  return [
    { page: 'map', label: 'Map', icon: 'map', href: mapDestination },
    { page: 'plan', label: 'Plan', icon: 'plan', href: '/plan' },
    { page: 'my-flights', label: 'My Flights', icon: 'flight', href: '/personal' },
    { page: 'profile', label: 'Profile', icon: 'profile', href: '/profile' },
  ];
}

function defaultActiveNavigationPage(input: AuthenticatedShellInput): PrimaryNavigationPage | null {
  if (input.page === 'map' && input.mapHref?.startsWith('/personal')) return 'my-flights';
  if (input.page === 'group') return 'map';
  if (input.page === 'plan' || input.page === 'profile') return input.page;
  return input.page === 'map' ? 'map' : null;
}

/** Build the shared shell for any authenticated refreshed-app page. */
export function createAuthenticatedShellModel(input: AuthenticatedShellInput): AuthenticatedShellModel {
  const displayName = input.user.displayName.trim() || 'Pilot';
  const activeNavigationPage = input.activeNavigationPage !== undefined
    ? input.activeNavigationPage
    : defaultActiveNavigationPage(input);
  const title = input.title ?? `${activeNavigationPage === 'my-flights' ? 'My Flights' : pageLabels[input.page]} · GlideHero`;

  return {
    page: input.page,
    activeNavigationPage,
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
