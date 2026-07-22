import { describe, expect, it } from 'vitest';
import { appPageFixture } from '../../src/views/app/fixtures.js';
import { createAppPageRenderer } from '../../src/views/app/appRenderer.js';
import type { AppPage } from '../../src/views/app/models.js';

describe('refreshed app UI renderer', () => {
  const render = createAppPageRenderer();
  const pages: AppPage[] = ['map', 'activity', 'achievements', 'profile'];

  it('renders every isolated page with the shared four-destination shell', async () => {
    for (const page of pages) {
      const html = await render(appPageFixture(page));
      expect(html).toContain(`<body class="app-ui-body app-ui-body--${page}">`);
      expect(html).toContain(`/styles/app-ui/${page}.css`);
      expect(html.match(/class="desktop-navigation__item/g)).toHaveLength(4);
      expect(html.match(/class="mobile-navigation__item/g)).toHaveLength(4);
      expect(html).toContain('>Map</span>');
      expect(html).toContain('>Activity</span>');
      expect(html).toContain('>Achievements</span>');
      expect(html).toContain('>Profile</span>');
      expect(html).toMatch(/data-upload-trigger[\s\S]*?<span>Upload<\/span>/);
      expect(html).toContain('data-upload-dialog');
      expect(html.indexOf('data-upload-trigger')).toBeLessThan(html.indexOf('data-account-trigger'));
      expect(html).toContain('Keep this page open until all files finish uploading.');
      expect(html).toContain('Processing flights. Results will appear on the map shortly.');
      expect(html).not.toContain('View achievements');
      expect(html).not.toContain('>Settings</span>');
      expect(html).not.toContain('Notification');
    }
  });

  it('renders the initials-only account menu and preserves conditional admin access', async () => {
    const admin = await render(appPageFixture('map'));
    expect(admin).toContain('initials-avatar initials-avatar--header');
    expect(admin).toContain('>AS</span>');
    expect(admin).toMatch(/icon-heart[\s\S]*?Donate<\/a>/);
    expect(admin).toMatch(/icon-shield[\s\S]*?Admin<\/a>/);
    expect(admin).toMatch(/icon-logout[\s\S]*?Log out<\/button>/);
    expect(admin).not.toContain('account-email');
    expect(admin).not.toContain('territory-color');

    const model = structuredClone(appPageFixture('map'));
    model.user.isAdmin = false;
    const pilot = await render(model);
    expect(pilot).not.toMatch(/icon-shield[\s\S]*?Admin<\/a>/);
  });

  it('honors the agreed page removals and footer rules', async () => {
    const map = await render(appPageFixture('map'));
    const activity = await render(appPageFixture('activity'));
    const profile = await render(appPageFixture('profile'));
    expect(map).not.toContain('class="app-footer"');
    expect(activity).toContain('class="app-footer"');
    expect(profile).toContain('class="app-footer"');
    expect(activity).not.toContain('Trending Achievements');
    expect(profile).not.toContain('Personal Map Preview');
    expect(profile).not.toContain('camera');
    expect(profile).not.toContain('<img class="profile');
  });

  it('keeps preview values in models and renders numeric-looking zero text', async () => {
    const model = structuredClone(appPageFixture('map'));
    if (model.page !== 'map') throw new Error('Expected Map fixture.');
    model.metrics[0]!.value = '0';
    model.leaderboard[0]!.cells = '0';
    const html = await render(model);
    expect(html).toContain('<strong>0</strong><span>Cells Owned</span>');
    expect(html).toContain('<b>0</b>');
  });
});
