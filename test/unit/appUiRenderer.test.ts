import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authenticatedPageFixture } from '../../src/views/authenticated/fixtures.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';
import type { AuthenticatedPage } from '../../src/views/authenticated/models.js';

describe('refreshed app UI renderer', () => {
  const render = createAuthenticatedPageRenderer();
  const pages: AuthenticatedPage[] = ['map', 'activity', 'achievements', 'profile'];

  it('keeps upload and processing status states visually exclusive', () => {
    const css = readFileSync('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('.flight-upload-progress[hidden] { display: none; }');
    expect(css).toContain('.flight-processing-state[hidden] { display: none; }');
    expect(css).toContain('.achievement-badge__artwork');
    expect(css).not.toContain('.achievement-badge svg');
  });

  it('renders extracted achievement artwork with an accessible dynamic label', async () => {
    const html = await render(authenticatedPageFixture('achievements'));
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

  it('keeps the MapLibre canvas sized after MapLibre applies its runtime class', () => {
    const mapCss = readFileSync('public/styles/app-ui/map.css', 'utf8');
    expect(mapCss).toContain('.map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }');
    expect(mapCss).toContain('.cell-popover[hidden] { display: none; }');
  });

  it('positions Arena search relative to the map stage', async () => {
    const html = await render(authenticatedPageFixture('map'));
    const mapStageStart = html.indexOf('<section class="map-stage"');
    const mapStageEnd = html.indexOf('</section>', mapStageStart);
    const arenaSearch = html.indexOf('data-map-arena-search');

    expect(mapStageStart).toBeGreaterThan(-1);
    expect(arenaSearch).toBeGreaterThan(mapStageStart);
    expect(arenaSearch).toBeLessThan(mapStageEnd);
    expect(html).toContain('class="map-arena-search" data-map-arena-search>');
    expect(html).not.toContain('data-map-arena-search hidden');
  });

  it('renders one responsive map sidebar and keeps the leaderboard competition-only', async () => {
    const personal = await render(authenticatedPageFixture('map'));
    const competitiveModel = structuredClone(authenticatedPageFixture('map'));
    if (competitiveModel.page !== 'map') throw new Error('Expected Map fixture.');
    competitiveModel.mode = 'competitive';
    const competitive = await render(competitiveModel);

    expect(personal.match(/class="map-sidebar"/g)).toHaveLength(1);
    expect(personal.match(/data-map-viewport-stats/g)).toHaveLength(1);
    expect(personal).not.toContain('Viewport Leaderboard');
    expect(personal).not.toContain('data-map-viewport-leaderboard');
    expect(competitive.match(/data-territory-leaderboard/g)).toHaveLength(1);
    expect(competitive).toContain('Viewport Leaderboard');
  });

  it('keeps the collapsed mobile drawer at a slim handle height', () => {
    const mapCss = readFileSync('public/styles/app-ui/map.css', 'utf8');
    expect(mapCss).toContain('height: clamp(25px, 5svh, 260px);');
    expect(mapCss).not.toContain('height: min(52svh, 460px);');
    expect(mapCss).not.toContain('.mobile-map-sheet { height: 52svh; }');
  });

  it('renders every isolated page with the shared four-destination shell', async () => {
    for (const page of pages) {
      const html = await render(authenticatedPageFixture(page));
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
    const admin = await render(authenticatedPageFixture('map'));
    expect(admin).toContain('initials-avatar initials-avatar--header');
    expect(admin).toContain('>AS</span>');
    expect(admin).toMatch(/icon-heart[\s\S]*?Donate<\/a>/);
    expect(admin).toMatch(/icon-shield[\s\S]*?Admin<\/a>/);
    expect(admin).toMatch(/icon-logout[\s\S]*?Log out<\/button>/);
    expect(admin).not.toContain('account-email');
    expect(admin).not.toContain('territory-color');

    const model = structuredClone(authenticatedPageFixture('map'));
    model.user.isAdmin = false;
    const pilot = await render(model);
    expect(pilot).not.toMatch(/icon-shield[\s\S]*?Admin<\/a>/);
  });

  it('honors the agreed page removals and footer rules', async () => {
    const map = await render(authenticatedPageFixture('map'));
    const activity = await render(authenticatedPageFixture('activity'));
    const profile = await render(authenticatedPageFixture('profile'));
    expect(map).not.toContain('class="app-footer"');
    expect(activity).toContain('class="app-footer"');
    expect(profile).toContain('class="app-footer"');
    expect(activity).not.toContain('Trending Achievements');
    expect(profile).not.toContain('Personal Map Preview');
    expect(profile).not.toContain('camera');
    expect(profile).not.toContain('<img class="profile');
  });

  it('keeps preview metric values in models and renders numeric-looking zero text', async () => {
    const model = structuredClone(authenticatedPageFixture('map'));
    if (model.page !== 'map') throw new Error('Expected Map fixture.');
    model.metrics[0]!.value = '0';
    const html = await render(model);
    expect(html).toContain('<strong>0</strong><span>Cells Owned</span>');
  });
});
