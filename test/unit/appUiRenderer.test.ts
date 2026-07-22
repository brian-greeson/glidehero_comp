import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appPageFixture } from '../../src/views/app/fixtures.js';
import { createAppPageRenderer } from '../../src/views/app/appRenderer.js';
import type { AppPage } from '../../src/views/app/models.js';

describe('refreshed app UI renderer', () => {
  const render = createAppPageRenderer();
  const pages: AppPage[] = ['map', 'activity', 'achievements', 'profile'];

  it('keeps upload and processing status states visually exclusive', () => {
    const css = readFileSync('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('.flight-upload-progress[hidden] { display: none; }');
    expect(css).toContain('.flight-processing-state[hidden] { display: none; }');
    expect(css).toContain('.achievement-badge__artwork');
    expect(css).not.toContain('.achievement-badge svg');
  });

  it('renders extracted achievement artwork with an accessible dynamic label', async () => {
    const html = await render(appPageFixture('achievements'));
    expect(html).toContain('class="achievement-badge__artwork" src="/images/app-ui/achievements/cell-explorer.png"');
    expect(html).toContain('width="256" height="256" alt="" aria-hidden="true"');
    expect(html).toContain('class="achievement-badge__label">10</span>');
    expect(html).not.toContain('class="achievement-badge__shadow"');
    const wrappers = html.match(/<span class="achievement-badge[^>]*" role="img" aria-label="[^"]+">/g) ?? [];
    expect(wrappers.length).toBeGreaterThan(0);
    expect(html.match(/role="img"/g)?.length).toBe(wrappers.length);
    expect(html.match(/class="achievement-badge__artwork"/g)?.length).toBe(wrappers.length);
    expect(html.match(/class="achievement-badge__label"/g)?.length).toBe(wrappers.length);
  });

  it('keeps artwork and labels sized for achievement rails and compact activity cards', () => {
    const achievementsCss = readFileSync('public/styles/app-ui/achievements.css', 'utf8');
    const activityCss = readFileSync('public/styles/app-ui/activity.css', 'utf8');
    expect(achievementsCss).toContain('.rail-progress .achievement-badge { width: 48px; height: 52px; }');
    expect(achievementsCss).toContain('.rail-progress .achievement-badge__label { font-size: .56rem; }');
    expect(activityCss).toContain('.activity-card__badges .achievement-badge { width: 50px; height: 55px; }');
    expect(activityCss).toContain('.activity-card__badges .achievement-badge__label { font-size: .62rem; }');
  });

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
      expect(html).toContain('Processing flights. You can safely navigate away; results will appear on the map shortly.');
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
