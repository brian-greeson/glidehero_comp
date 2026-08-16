import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

function model(mode: 'personal' | 'following' | 'competitive' = 'following', period: 'current-month' | 'all-time' = 'current-month') {
  return {
    ...createAuthenticatedShellModel({ page: 'map' as const, user: { displayName: 'Pilot' }, mapHref: '/following' }),
    page: 'map' as const,
    mode,
    period,
    location: null,
    leaderboard: [],
  };
}

describe('flight-first map UI', () => {
  it('renders a flight map without competition product surfaces', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('class="flight-map-page"');
    expect(html).toContain('aria-label="Flight browser"');
    expect(html).toContain('data-track-endpoint="/v1/map-flights/tracks"');
    expect(html).toContain('data-list-endpoint="/v1/map-flights"');
    expect(html).not.toContain('data-territory-map');
    expect(html).not.toContain('data-territory-leaderboard');
    expect(html).not.toContain('Arena search');
  });

  it('renders Personal, Following, and All Pilots in the flight browser', async () => {
    const personal = await createAuthenticatedPageRenderer()(model('personal'));
    expect(personal).toContain('<option value="personal" selected>My Flights</option>');
    expect(personal).toContain('<option value="following">Following</option>');
    expect(personal).toContain('<option value="all">All Pilots</option>');
    expect(personal).toContain('data-styled-select-trigger aria-haspopup="listbox"');
    expect(personal).toContain('data-styled-select-option="following"');
    const all = await createAuthenticatedPageRenderer()(model('competitive'));
    expect(all).toContain('<option value="all" selected>All Pilots</option>');
  });

  it('defaults to Global geography and Distance sort with explicit Load more', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('data-map-geography="global" aria-pressed="true"');
    expect(html).toContain('data-map-geography="map-area" aria-pressed="false"');
    expect(html).toContain('<option value="distance" selected>Distance</option>');
    expect(html).toContain('data-flight-load-more hidden>Load more</button>');
  });

  it('offers Day, Month, Year, and All Time with month selected by default', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('<option value="day">Day</option>');
    expect(html).toContain('<option value="month" selected>Month</option>');
    expect(html).toContain('<option value="year">Year</option>');
    expect(html).toContain('<option value="all-time">All Time</option>');
    expect(html).toContain('data-styled-select-option="all-time"');
    const allTime = await createAuthenticatedPageRenderer()(model('following', 'all-time'));
    expect(allTime).toContain('<option value="all-time" selected>All Time</option>');
  });

  it('keeps Activity and Achievements in navigation', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('href="/activity"');
    expect(html).toContain('href="/achievements"');
  });

  it('styles a persistent desktop panel and three mobile sheet states', async () => {
    const css = await readFile('public/styles/app-ui/map.css', 'utf8');
    expect(css).toContain('grid-template-columns: minmax(416px, 440px) minmax(0, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(128px, 1.15fr) minmax(164px, 1.45fr) minmax(100px, .9fr)');
    expect(css).toContain('.flight-browser.is-collapsed');
    expect(css).toContain('.flight-browser.is-partial');
    expect(css).toContain('.flight-browser.is-expanded');
    expect(css).toContain('.flight-map-stage > .flight-map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
