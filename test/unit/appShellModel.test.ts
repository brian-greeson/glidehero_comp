import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel, initialsForDisplayName } from '../../src/views/authenticated/adapters/shellModel.js';

describe('refreshed app shell model', () => {
  it('creates compact initials from a display name', () => {
    expect(initialsForDisplayName('Alex Summit')).toBe('AS');
    expect(initialsForDisplayName('  alex  ')).toBe('AL');
    expect(initialsForDisplayName('')).toBe('P');
  });

  it('uses production navigation and account defaults', () => {
    const model = createAuthenticatedShellModel({
      page: 'map',
      user: { displayName: 'Alex Summit', email: 'alex@example.com' },
      isAdmin: true,
    });

    expect(model.navigation.map((item) => item.href)).toEqual([
      '/following', '/plan', '/activity', '/achievements', '/profile',
    ]);
    expect(model.user).toEqual({ displayName: 'Alex Summit', initials: 'AS', isAdmin: true });
    expect(model.donateUrl).toBe('https://ko-fi.com/U6U0I4TSK');
    expect(model.adminUrl).toBe('/admin');
    expect(model.logoutUrl).toBe('/logout');
    expect(model.showFooter).toBe(false);
  });

  it('keeps map active while preserving a global or Arena map destination', () => {
    const global = createAuthenticatedShellModel({
      page: 'map',
      mapHref: '/global?month=2026-07',
      user: { displayName: 'Pilot' },
    });
    const arena = createAuthenticatedShellModel({
      page: 'map',
      mapHref: '/arena/123',
      user: { displayName: 'Pilot' },
    });

    expect(global.navigation[0]).toMatchObject({ page: 'map', href: '/global?month=2026-07' });
    expect(arena.navigation[0]).toMatchObject({ page: 'map', href: '/arena/123' });
    expect(global.navigation.filter((item) => item.page === 'map')).toHaveLength(1);
  });
});
