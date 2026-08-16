import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createMapPageModel } from '../../src/views/authenticated/adapters/mapView.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

function model(
  mode: 'personal' | 'following' | 'competitive' = 'following',
  period: 'current-month' | 'all-time' = 'current-month',
  groups: Array<{ id: string; name: string }> = [],
  selectedGroup?: { id: string; name: string },
) {
  return {
    ...createAuthenticatedShellModel({ page: 'map' as const, user: { displayName: 'Pilot' }, mapHref: mode === 'personal' ? '/personal' : mode === 'competitive' ? '/global' : '/following' }),
    page: 'map' as const,
    mode,
    period,
    defaultSort: mode === 'competitive' ? 'distance' as const : 'latest' as const,
    location: null,
    leaderboard: [],
    groupOptions: groups,
    selectedGroup: selectedGroup ?? null,
  };
}

describe('flight-first map UI', () => {
  it('renders a flight map without competition product surfaces', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('class="flight-map-page"');
    expect(html).toContain('aria-label="Flight browser"');
    expect(html).toContain('data-track-endpoint="/v1/map-flights/tracks"');
    expect(html).toContain('data-list-endpoint="/v1/map-flights"');
    expect(html).toContain('data-launch-endpoint="/v1/map-launches"');
    expect(html).toContain('data-launch-detail-endpoint-template="/v1/map-launches/{launchId}"');
    expect(html).not.toContain('data-territory-map');
    expect(html).not.toContain('data-territory-leaderboard');
    expect(html).not.toContain('Arena search');
  });

  it('renders the visible-by-default launch toggle and reusable information panel', async () => {
    const html = await createAuthenticatedPageRenderer()(model('personal'));
    expect(html).toContain('data-map-launch-toggle aria-pressed="true"');
    expect(html).toContain('data-launch-info-panel');
    expect(html).toContain('data-launch-info-name');
    expect(html).toContain('data-launch-info-location');
    expect(html).toContain('data-launch-info-elevation');
    expect(html).toContain('data-launch-info-flight-count');
    expect(html).toContain('data-launch-info-visited');
    expect(html).toContain('data-launch-info-description');
    expect(html).toContain('data-launch-info-filter>Show flights from this launch</button>');
    expect(html).toContain('data-personal-history');
    expect(html).toContain('data-launch-selector');
    expect(html).toContain('data-launch-selector-input');
    expect(html).not.toContain('data-map-launch-filter');
    const following = await createAuthenticatedPageRenderer()(model('following'));
    expect(following).not.toContain('data-personal-history');
    expect(following).toContain('data-launch-selector');
  });

  it('removes the pilot selector from My Flights and offers only Following and All Pilots on Map', async () => {
    const personal = await createAuthenticatedPageRenderer()(model('personal'));
    expect(personal).not.toContain('data-map-scope');
    expect(personal).not.toContain('data-styled-select-option="personal"');
    const following = await createAuthenticatedPageRenderer()(model('following'));
    expect(following).toContain('<option value="following" selected>Following</option>');
    expect(following).toContain('<option value="all">All Pilots</option>');
    expect(following).not.toContain('<option value="personal"');
    expect(following).toContain('data-styled-select-option="following"');
    const all = await createAuthenticatedPageRenderer()(model('competitive'));
    expect(all).toContain('<option value="all" selected>All Pilots</option>');
  });

  it('renders accepted group choices after an unlabeled nonselectable separator', async () => {
    const html = await createAuthenticatedPageRenderer()(model('following', 'current-month', [
      { id: 'alpine-id', name: 'Alpine Club' },
      { id: 'zephyr-id', name: 'Zephyr Pilots' },
    ]));

    expect(html.indexOf('data-styled-select-option="following"')).toBeLessThan(html.indexOf('data-styled-select-option="all"'));
    expect(html.indexOf('data-styled-select-option="all"')).toBeLessThan(html.indexOf('class="map-select__separator"'));
    expect(html.indexOf('class="map-select__separator"')).toBeLessThan(html.indexOf('data-styled-select-option="group:alpine-id"'));
    expect(html.indexOf('data-styled-select-option="group:alpine-id"')).toBeLessThan(html.indexOf('data-styled-select-option="group:zephyr-id"'));
    expect(html).toContain('<div class="map-select__separator" role="separator" aria-hidden="true">——</div>');
    expect(html).not.toContain('data-styled-select-option="separator"');
    expect(html).toContain('<option value="group:alpine-id">Alpine Club</option>');
    expect(html).toContain('<option value="group:zephyr-id">Zephyr Pilots</option>');
  });

  it('shows the selected group name and omits group UI from empty and personal scopes', async () => {
    const groups = [{ id: 'alpine-id', name: 'Alpine Club' }];
    const selected = await createAuthenticatedPageRenderer()(model('following', 'current-month', groups, groups[0]));
    expect(selected).toContain('<option value="group:alpine-id" selected>Alpine Club</option>');
    expect(selected).toContain('<span data-styled-select-value>Alpine Club</span>');
    expect(selected).toContain('data-styled-select-option="group:alpine-id" aria-selected="true"');

    const empty = await createAuthenticatedPageRenderer()(model());
    expect(empty).not.toContain('class="map-select__separator"');
    expect(empty).not.toContain('data-styled-select-option="group:');

    const personal = await createAuthenticatedPageRenderer()(model('personal', 'all-time', groups, groups[0]));
    expect(personal).not.toContain('data-map-scope');
    expect(personal).not.toContain('Alpine Club');
    expect(personal).not.toContain('class="map-select__separator"');
  });

  it('uses Latest for Following and My Flights, and Distance for All Pilots', async () => {
    const html = await createAuthenticatedPageRenderer()(model('following'));
    expect(html).toContain('data-map-geography="global" aria-pressed="true"');
    expect(html).toContain('data-map-geography="map-area" aria-pressed="false"');
    expect(html).toContain('<option value="latest" selected>Latest</option>');
    expect(await createAuthenticatedPageRenderer()(model('personal'))).toContain('<option value="latest" selected>Latest</option>');
    expect(await createAuthenticatedPageRenderer()(model('competitive'))).toContain('<option value="distance" selected>Distance</option>');
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
    const personal = await createAuthenticatedPageRenderer()(model('personal', 'all-time'));
    expect(personal).not.toContain('<option value="day">Day</option>');
    expect(personal).toContain('<option value="custom">Custom Range</option>');
    expect(personal).toContain('data-map-custom-start');
  });

  it('renders the four primary destinations and highlights My Flights independently', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('href="/personal"');
    expect(html).not.toContain('href="/achievements"');
    const personal = await createAuthenticatedPageRenderer()(model('personal'));
    expect(personal).toContain('desktop-navigation__item is-active" href="/personal" aria-current="page"');
    expect(personal).not.toContain('desktop-navigation__item is-active" href="/following"');
  });

  it('applies scope-aware period and sort defaults without overriding explicit time state', () => {
    const shell = createAuthenticatedShellModel({ page: 'map', user: { displayName: 'Pilot' }, mapHref: '/personal' });
    const common = { location: null, currentUserId: 'pilot-id', territoryColor: '#1769AA' };
    const personal = createMapPageModel(shell, { ...common, mode: 'personal', period: 'current-month', mapHref: '/personal' });
    const explicitPersonal = createMapPageModel(shell, { ...common, mode: 'personal', period: 'current-month', mapHref: '/personal?period=month&anchor=2026-08-01' });
    const following = createMapPageModel(createAuthenticatedShellModel({ page: 'map', user: { displayName: 'Pilot' }, mapHref: '/following' }), { ...common, mode: 'following', period: 'current-month', mapHref: '/following' });
    const all = createMapPageModel(createAuthenticatedShellModel({ page: 'map', user: { displayName: 'Pilot' }, mapHref: '/global' }), { ...common, mode: 'competitive', period: 'current-month', mapHref: '/global' });

    expect(personal).toMatchObject({ period: 'all-time', defaultSort: 'latest' });
    expect(explicitPersonal).toMatchObject({ period: 'current-month', defaultSort: 'latest' });
    expect(following).toMatchObject({ period: 'current-month', defaultSort: 'latest' });
    expect(all).toMatchObject({ period: 'current-month', defaultSort: 'distance' });
  });

  it('resolves the selected group from accepted group options without changing map mode defaults', () => {
    const shell = createAuthenticatedShellModel({ page: 'map', user: { displayName: 'Pilot' }, mapHref: '/following?group=alpine-id' });
    const result = createMapPageModel(shell, {
      mode: 'following',
      period: 'current-month',
      location: null,
      mapHref: '/following?group=alpine-id',
      currentUserId: 'pilot-id',
      territoryColor: '#1769AA',
      groupOptions: [{ id: 'alpine-id', name: 'Alpine Club' }],
      selectedGroupId: 'alpine-id',
    });

    expect(result).toMatchObject({
      mode: 'following',
      period: 'current-month',
      defaultSort: 'latest',
      groupOptions: [{ id: 'alpine-id', name: 'Alpine Club' }],
      selectedGroup: { id: 'alpine-id', name: 'Alpine Club' },
    });
  });

  it('styles a persistent desktop panel and three mobile sheet states', async () => {
    const css = await readFile('public/styles/app-ui/map.css', 'utf8');
    const appCss = await readFile('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('grid-template-columns: minmax(416px, 440px) minmax(0, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(128px, 1.15fr) minmax(164px, 1.45fr) minmax(100px, .9fr)');
    expect(css).toContain('.flight-browser.is-collapsed');
    expect(css).toContain('.flight-browser.is-partial');
    expect(css).toContain('.flight-browser.is-expanded');
    expect(css).toContain('.flight-map-stage > .flight-map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(appCss).toContain('.app-ui-body .app-bottom-sheet { --app-bottom-sheet-handle-height: 24px; border-radius: 1.5rem 1.5rem 0 0; }');
    expect(appCss).toContain('.app-bottom-sheet > .app-bottom-sheet__handle { display: grid;');
    expect(css).not.toContain('.flight-browser__handle { display: grid;');
    expect(css).toContain('grid-template-columns: minmax(0, .9fr) minmax(0, 1.2fr) minmax(0, .8fr);');
    expect(css).toContain('.flight-map-status { top: 4.25rem; }');
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('flight-browser app-bottom-sheet is-partial');
    expect(html).toContain('flight-browser__handle app-bottom-sheet__handle');
    expect(html).toContain('flight-browser__content app-bottom-sheet__content');
  });

  it('places compact launch search in the map header and retains the floating time arrows', async () => {
    const html = await createAuthenticatedPageRenderer()(model());
    expect(html).toContain('app-header app-header--map');
    expect(html.indexOf('data-launch-selector')).toBeLessThan(html.indexOf('data-upload-trigger'));
    expect(html).toContain('data-map-period-step="previous"');
    expect(html).toContain('icons.svg#icon-calendar');
    expect(html).toContain('data-map-period-step="next"');
    expect(html).toContain('icons.svg#icon-search');
    const css = await readFile('public/styles/app-ui/app.css', 'utf8');
    expect(css).toContain('.app-header--map { z-index: 39;');
  });
});
