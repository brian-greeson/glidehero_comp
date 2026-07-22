import type {
  AchievementView,
  ActivityPageModel,
  AuthenticatedPageModel,
  AuthenticatedShellModel,
  FlightView,
  MapPageModel,
  ProfilePageModel,
} from './models.js';

const navigation = [
  { page: 'map' as const, label: 'Map', icon: 'map' as const, href: '/map' },
  { page: 'activity' as const, label: 'Activity', icon: 'activity' as const, href: '/activity' },
  { page: 'achievements' as const, label: 'Achievements', icon: 'trophy' as const, href: '/achievements' },
  { page: 'profile' as const, label: 'Profile', icon: 'profile' as const, href: '/profile' },
];

function shell(page: AuthenticatedShellModel['page'], showFooter = page !== 'map'): AuthenticatedShellModel {
  return {
    page,
    title: `${page[0]!.toUpperCase()}${page.slice(1)} · GlideHero`,
    user: { displayName: 'Alex Summit', initials: 'AS', isAdmin: true },
    navigation,
    donateUrl: 'https://ko-fi.com/U6U0I4TSK',
    adminUrl: '/admin',
    logoutUrl: '/logout',
    showFooter,
    preview: true,
  };
}

const pilots = {
  alex: { displayName: 'Alex Summit', initials: 'AS', color: '#1769AA' },
  ben: { displayName: 'Ben', initials: 'B', color: '#ff6b24' },
  anna: { displayName: 'Anna', initials: 'A', color: '#17b7ca' },
  leo: { displayName: 'Leo', initials: 'L', color: '#43a52c' },
  mia: { displayName: 'Mia', initials: 'M', color: '#7441b6' },
};

const earned: AchievementView[] = [
  { key: 'first-steps', artworkKey: 'cell-explorer', title: 'First Steps', description: 'Claim 10 unique cells.', badgeLabel: '10', tone: 'green', earnedDate: 'Jun 5, 2026' },
  { key: 'distance-seeker', artworkKey: 'distance-record', title: 'Distance Seeker', description: 'Set a personal best.', badgeLabel: 'PB', tone: 'blue', earnedDate: 'Jun 12, 2026' },
  { key: 'century-club', artworkKey: 'cell-explorer', title: 'Century Club', description: 'Claim 100 unique cells.', badgeLabel: '100', tone: 'orange', earnedDate: 'Jul 2, 2026' },
  { key: 'arena-explorer', artworkKey: 'arenas-touched', title: 'Arena Explorer', description: 'Touch 3 different Arenas in a single flight.', badgeLabel: '3', tone: 'purple', earnedDate: 'Jul 8, 2026' },
];

const inProgress: AchievementView[] = [
  { key: 'quarter-century', artworkKey: 'cell-explorer', title: 'Quarter Century', description: 'Claim 25 unique cells on your Personal Map.', badgeLabel: '25', tone: 'green', current: '17', target: '25', percent: 68 },
  { key: 'high-explorer', artworkKey: 'mapper', title: 'High Explorer', description: 'Reach 500 unique cells on your Personal Map.', badgeLabel: '500', tone: 'orange', current: '237', target: '500', percent: 47 },
  { key: 'distance-master', artworkKey: 'distance-record', title: 'Distance Master', description: 'Beat your personal best for most cells claimed in a flight.', badgeLabel: 'PB', tone: 'blue', current: '843', target: '1,000', percent: 84 },
  { key: 'arena-adventurer', artworkKey: 'arenas-touched', title: 'Arena Adventurer', description: 'Touch 5 different Arenas in a single flight.', badgeLabel: '5', tone: 'purple', current: '3', target: '5', percent: 60 },
];

const flights: FlightView[] = [
  { id: 'flight-1', pilot: pilots.ben, date: 'Jun 5, 2026 · 2:14 PM', arena: 'Swiss Alps Arena', distance: '18.6 km', cells: '42', achievements: '3', mapTone: 'orange' },
  { id: 'flight-2', pilot: pilots.anna, date: 'Jun 2, 2026 · 11:08 AM', arena: 'Pyrenees Arena', distance: '67.8 km', cells: '286', achievements: '4', mapTone: 'blue' },
  { id: 'flight-3', pilot: pilots.leo, date: 'May 29, 2026 · 4:35 PM', arena: 'Colorado Front Range', distance: '48.2 km', cells: '198', achievements: '1', mapTone: 'cyan' },
  { id: 'flight-4', pilot: pilots.mia, date: 'May 27, 2026 · 9:42 AM', arena: 'Utah Wasatch', distance: '37.6 km', cells: '143', achievements: '2', mapTone: 'purple' },
];

const mapPage: MapPageModel = {
  ...shell('map', false),
  page: 'map',
  mode: 'personal',
  period: 'all-time',
  location: 'Swiss Alps Arena',
  metrics: [
    { label: 'Cells Owned', value: '1,248', icon: 'cell', tone: 'green' },
    { label: 'Unique Cells', value: '2,867', icon: 'trophy', tone: 'blue' },
    { label: 'Flights This Month', value: '18', icon: 'activity', tone: 'purple' },
    { label: 'Arenas Touched', value: '9', icon: 'arena', tone: 'orange' },
  ],
  leaderboard: [
    { rank: 1, pilot: pilots.alex, cells: '1,248', isCurrent: true },
    { rank: 2, pilot: pilots.ben, cells: '986', isCurrent: false },
    { rank: 3, pilot: pilots.anna, cells: '842', isCurrent: false },
    { rank: 4, pilot: pilots.leo, cells: '721', isCurrent: false },
    { rank: 5, pilot: pilots.mia, cells: '615', isCurrent: false },
  ],
  selectedFlight: flights[0]!,
  selectedCell: { name: 'Cell H7', owner: 'Owned by You', altitude: '2,340 m', lastClaimed: '1h ago' },
};

const activityPage: ActivityPageModel = {
  ...shell('activity'),
  page: 'activity',
  metrics: [
    { label: 'Following Updates', value: '12', detail: 'Stay connected!', icon: 'people', tone: 'blue' },
    { label: 'Your Activities', value: '4', detail: 'Keep soaring!', icon: 'activity', tone: 'green' },
    { label: 'New Achievements Seen', value: '9', detail: 'Nice work!', icon: 'star', tone: 'purple' },
  ],
  events: [
    { id: 'event-1', kind: 'achievements', pilot: pilots.ben, timeAgo: '2h ago', title: 'Ben earned 3 achievements from one flight', detail: 'Soared 42.3 km in the Swiss Alps', arena: 'Swiss Alps Arena', likes: '24', comments: '6', flight: flights[0], achievements: earned.slice(0, 3) },
    { id: 'event-2', kind: 'flight', pilot: pilots.anna, timeAgo: '5h ago', title: 'Anna uploaded a flight and claimed 42 new cells', detail: 'Personal best flight covering 67.8 km', arena: 'Pyrenees Arena', likes: '31', comments: '8', flight: flights[1], achievements: [earned[0]!, earned[2]!, earned[1]!, earned[3]!] },
    { id: 'event-3', kind: 'challenge', pilot: pilots.leo, timeAgo: '1d ago', title: 'Leo completed a challenge', detail: 'High Explorer — Reach 500 unique cells', arena: 'Dolomites Arena', likes: '18', comments: '3', achievements: [inProgress[1]!], progress: { current: '500', target: '500', percent: 100 } },
  ],
  following: [
    { pilot: pilots.ben, detail: 'Earned 3 achievements', timeAgo: '2h ago' },
    { pilot: pilots.anna, detail: 'Uploaded a new flight', timeAgo: '5h ago' },
    { pilot: pilots.leo, detail: 'Completed a challenge', timeAgo: '1d ago' },
    { pilot: pilots.mia, detail: 'Earned 2 achievements', timeAgo: '2d ago' },
  ],
  weekly: [
    { label: 'Flights', value: '18', change: '12%', icon: 'flight' },
    { label: 'Distance', value: '286 km', change: '18%', icon: 'activity' },
    { label: 'Cells Claimed', value: '742', change: '24%', icon: 'cell' },
    { label: 'Achievements Earned', value: '27', change: '35%', icon: 'trophy' },
  ],
  activitySearch: '',
  activityPilotResults: [],
  activityReturnTo: '/activity',
  activityScopeLinks: { all: '/activity', following: '/activity?scope=following', yours: '/activity?scope=yours' },
  activityScope: 'all',
};

const achievementsPage = {
  ...shell('achievements'),
  page: 'achievements' as const,
  metrics: [
    { label: 'Achievements Earned', value: '23', detail: 'Keep soaring!', icon: 'check', tone: 'green' as const },
    { label: 'In Progress', value: '7', detail: 'On your way!', icon: 'progress', tone: 'blue' as const },
  ],
  earned,
  inProgress,
  recentlyEarned: earned.slice(0, 3),
};

const profilePage: ProfilePageModel = {
  ...shell('profile'),
  page: 'profile',
  profile: {
    displayName: 'Alex Summit', initials: 'AS', handle: '@alexsummit', tier: 'Pro Pilot',
    location: 'Boulder, Colorado, USA',
    bio: 'Chasing lift, painting maps, and exploring new horizons. Every flight adds a little more color to the world.',
    memberSince: 'May 2024', followers: '342', following: '198',
  },
  metrics: [
    { label: 'Unique Cells', value: '18,642', detail: 'All Time', icon: 'map', tone: 'green' },
    { label: 'Flights Uploaded', value: '248', detail: 'All Time', icon: 'flight', tone: 'purple' },
    { label: 'Arenas Touched', value: '127', detail: 'All Time', icon: 'flag', tone: 'blue' },
    { label: 'Achievements Earned', value: '56', detail: 'All Time', icon: 'trophy', tone: 'orange' },
  ],
  titles: [
    { name: 'Colorado', detail: 'Top Cell Holder', since: 'Since May 25, 2026', icon: 'mountain', tone: 'green' },
    { name: 'Wyoming', detail: 'Top Cell Holder', since: 'Since Jun 2, 2026', icon: 'flag', tone: 'orange' },
    { name: 'San Juan Mountains', detail: 'Top Cell Holder', since: 'Since Jun 5, 2026', icon: 'mountain', tone: 'blue' },
    { name: 'North America', detail: 'Top Cell Holder', since: 'Since Jun 1, 2026', icon: 'globe', tone: 'purple' },
  ],
  flights,
  glider: { brand: 'Ozone', model: 'Enzo 3', color: 'Teal / White' },
};

const pages: Record<AuthenticatedShellModel['page'], AuthenticatedPageModel> = {
  map: mapPage,
  activity: activityPage,
  achievements: achievementsPage,
  profile: profilePage,
};

export function authenticatedPageFixture(page: AuthenticatedShellModel['page']): AuthenticatedPageModel {
  return pages[page];
}
