import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapUrlControls } from '../../public/scripts/app-ui/map.js';

function node() {
  const listeners = new Map<string, (event?: any) => void>();
  const attributes = new Map<string, string>();
  return {
    hidden: true,
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
});
