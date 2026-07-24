import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapUrlControls } from '../../public/scripts/app-ui/map.js';
// @ts-expect-error Browser asset remains JavaScript.
import { initializeCompetitionPeriodControl } from '../../public/scripts/competitionPeriod.js';
// @ts-expect-error Browser asset remains JavaScript.
import { initializeMapMobileControls } from '../../public/scripts/app-ui/mapMobileControls.js';

function node() {
  const listeners = new Map<string, (event?: any) => void>();
  const attributes = new Map<string, string>();
  return {
    hidden: true,
    disabled: false,
    href: '/global',
    dataset: {} as Record<string, string>,
    addEventListener(name: string, listener: (event?: any) => void) { listeners.set(name, listener); },
    dispatch(name: string, event?: any) { listeners.get(name)?.(event); },
    getAttribute(name: string) { return attributes.get(name) ?? this.href; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    querySelector: vi.fn(() => ({ focus: vi.fn() })),
  };
}

describe('refreshed map UI controls', () => {
  it('renders full and compact leaderboards only on Competitive maps', async () => {
    const render = createAuthenticatedPageRenderer();
    const mapModel = (mode: 'personal' | 'competitive') => ({
      ...createAuthenticatedShellModel({
        page: 'map' as const,
        user: { displayName: 'Pilot' },
        mapHref: mode === 'personal' ? '/personal' : '/global',
      }),
      page: 'map' as const,
      mode,
      period: 'current-month' as const,
      location: 'Global',
      metrics: [],
      leaderboard: [],
    });

    const competitive = await render(mapModel('competitive'));
    expect(competitive.match(/data-territory-leaderboard(?:[ =])/g)).toHaveLength(2);
    expect(competitive).toContain('data-territory-leaderboard-variant="full"');
    expect(competitive).toContain('data-territory-leaderboard-variant="compact"');
    expect(competitive).toContain('map-leaderboard--compact');

    const personal = await render(mapModel('personal'));
    expect(personal).not.toContain('data-territory-leaderboard');
    expect(personal).not.toContain('map-leaderboard--compact');
    expect(personal).not.toContain('Viewport Leaderboard');
  });

  it('keeps the compact leaderboard mobile-only and exposes one surface opacity control', async () => {
    const css = await readFile('public/styles/app-ui/map.css', 'utf8');
    const opacityVariable = '--mobile-leaderboard-surface-opacity';

    expect(css.match(new RegExp(opacityVariable, 'g'))).toHaveLength(2);
    expect(css).toContain(`${opacityVariable}: .9`);
    expect(css).toContain(`rgb(255 255 255 / var(${opacityVariable}))`);
    expect(css).toContain('.map-leaderboard--compact { display: none; }');
    expect(css).toContain('.map-mobile-replay { display: none; }');

    const mobileRules = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(mobileRules).toContain('.map-leaderboard--compact { position: absolute;');
    expect(mobileRules).toContain('.map-mobile-controls { position: absolute;');
    expect(mobileRules).toContain('.map-mobile-view__menu { position: absolute;');
    expect(mobileRules).toContain('overflow: visible;');
    expect(mobileRules).toContain('.map-mobile-replay { display: block; }');
    expect(mobileRules).toContain('.map-leaderboard--compact { position: absolute; z-index: 8; bottom: calc(4rem + env(safe-area-inset-bottom, 0px));');
    expect(mobileRules).toContain('.map-arena-search { top: .75rem; width: 50%; }');
    expect(mobileRules).not.toContain('.mobile-map-sheet { position: fixed;');
    expect(css.slice(css.indexOf('@media (max-width: 390px)'))).toContain('.map-mobile-period-controls { right: .75rem; left: .75rem; }');
  });

  it('renders the mobile map-view dropdown and period controls without the map sheet', async () => {
    const render = createAuthenticatedPageRenderer();
    const html = await render({
      ...createAuthenticatedShellModel({ page: 'map' as const, user: { displayName: 'Pilot' }, mapHref: '/personal' }),
      page: 'map' as const,
      mode: 'personal',
      period: 'current-month' as const,
      location: 'Global',
      metrics: [],
      leaderboard: [],
    });
    expect(html).toContain('class="map-mobile-controls"');
    expect(html).toContain('data-map-mobile-view-trigger');
    expect(html).toContain('>My Flights</span>');
    expect(html).toContain('>Following</span>');
    expect(html).toContain('>All Pilots</span>');
    expect(html).toContain('data-competition-period-option="all-time" aria-pressed="false"');
    expect(html).toContain('data-competition-period-option="current-month" aria-pressed="true"');
    expect(html).toContain('data-competition-month-nav="previous" aria-label="Previous month">‹</button>');
    expect(html).toContain('data-competition-month-nav="next" aria-label="Next month">›</button>');
    expect(html).not.toContain('data-map-sheet');
    expect(html).not.toContain('map-scale');
  });

  it('opens, dismisses, and restores focus for the mobile map-view dropdown', () => {
    const listeners = new Map<string, (event?: any) => void>();
    const trigger = { setAttribute: vi.fn(), focus: vi.fn(), addEventListener: vi.fn((name, fn) => listeners.set(`trigger:${name}`, fn)) };
    const activeLink = { focus: vi.fn(), addEventListener: vi.fn() };
    const menu = { hidden: true, querySelector: vi.fn(() => activeLink), addEventListener: vi.fn() };
    const root = { contains: vi.fn(() => false), querySelector: vi.fn((selector) => selector.includes('trigger') ? trigger : menu), querySelectorAll: vi.fn(() => []), addEventListener: vi.fn() };
    const documentRef = { querySelector: vi.fn(() => root), addEventListener: vi.fn((name, fn) => listeners.set(`document:${name}`, fn)) };
    initializeMapMobileControls(documentRef);
    listeners.get('trigger:click')?.();
    expect(menu.hidden).toBe(false);
    expect(trigger.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
    expect(activeLink.focus).toHaveBeenCalledOnce();
    listeners.get('document:keydown')?.({ key: 'Escape' });
    expect(menu.hidden).toBe(true);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it('turns period controls into links that preserve map URL state', () => {
    const allTime = node();
    allTime.dataset.mapPeriodLink = 'all-time';
    const currentMonth = node();
    currentMonth.dataset.mapPeriodLink = 'current-month';
    const documentRef = {
      querySelectorAll(selector: string) {
        return selector === '[data-map-period-link]' ? [allTime, currentMonth] : [];
      },
    };

    const historyRef = { replaceState: vi.fn() };
    initializeMapUrlControls({
      documentRef,
      locationRef: { origin: 'https://glidehero.test', pathname: '/global', search: '?month=2026-06' },
      historyRef,
      now: () => new Date('2026-07-22T12:00:00Z'),
    });

    expect(allTime.href).toBe('/global?period=all-time');
    expect(currentMonth.href).toBe('/global?month=2026-07');
    expect(historyRef.replaceState).not.toHaveBeenCalled();
  });

  it('canonicalizes a bare map URL to the browser current month', () => {
    const historyRef = { replaceState: vi.fn() };
    const selection = initializeMapUrlControls({
      documentRef: { querySelectorAll: () => [] },
      locationRef: { origin: 'https://glidehero.test', pathname: '/personal', search: '?lat=39' },
      historyRef,
      now: () => new Date('2026-07-22T12:00:00Z'),
    });

    expect(selection).toEqual({ period: 'current-month', month: '2026-07' });
    expect(historyRef.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/personal?lat=39&month=2026-07',
    );
  });

  it('focuses the always-visible Arena search from the location trigger', () => {
    const trigger = node();
    const search = node();
    search.hidden = false;
    const input = { focus: vi.fn() };
    search.querySelector = vi.fn(() => input);
    const documentRef = {
      querySelectorAll(selector: string) {
        return selector === '[data-map-period-link]' ? [] : [trigger];
      },
      querySelector(selector: string) {
        return selector === '[data-map-arena-search]' ? search : undefined;
      },
    };

    initializeMapUrlControls({ documentRef, locationRef: { origin: 'https://glidehero.test', pathname: '/global', search: '' } });
    trigger.dispatch('click');

    expect(search.hidden).toBe(false);
    expect(input.focus).toHaveBeenCalledOnce();
  });

  it('disables forward month navigation at the browser-local current month', () => {
    const previous = node(); previous.dataset.competitionMonthNav = 'previous';
    const next = node(); next.dataset.competitionMonthNav = 'next';
    const documentRef = { querySelectorAll(selector: string) {
      return selector === '[data-competition-month-nav]' ? [previous, next] : [];
    } };
    initializeCompetitionPeriodControl({
      documentRef,
      locationRef: { pathname: '/global', search: '?month=2026-07' },
      now: () => new Date('2026-07-24T12:00:00Z'),
    });
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    expect(next.getAttribute('aria-disabled')).toBe('true');
  });
});
