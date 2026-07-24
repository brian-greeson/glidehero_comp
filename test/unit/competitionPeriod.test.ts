import { describe, expect, it, vi } from 'vitest';
// Browser asset intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { ALL_TIME_COMPETITION_PERIOD, CURRENT_MONTH_COMPETITION_PERIOD, competitionMonthFromSearch, competitionPageUrl, initializeCompetitionPeriodControl } from '../../public/scripts/competitionPeriod.js';

function button(period: string) {
  const listeners = new Map<string, () => Promise<void>>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    disabled: false,
    hidden: false,
    dataset: { competitionPeriodOption: period, competitionMonthNav: '' },
    classList: {
      toggle(name: string, enabled: boolean) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    addEventListener(name: string, listener: () => Promise<void>) { listeners.set(name, listener); },
    click: () => listeners.get('click')?.(),
    isActive: () => classes.has('is-active'),
    attribute: (name: string) => attributes.get(name),
  };
}

function setup(search = '') {
  const allTime = button(ALL_TIME_COMPETITION_PERIOD);
  const currentMonth = button(CURRENT_MONTH_COMPETITION_PERIOD);
  const label = { textContent: '' };
  const globalLink = { dataset: { competitionPeriodLink: '/global' }, href: '' };
  const returnTo = { value: '' };
  const previous = button('');
  previous.dataset.competitionMonthNav = 'previous';
  const next = button('');
  next.dataset.competitionMonthNav = 'next';
  const historyRef = { replaceState: vi.fn() };
  const onChange = vi.fn();
  const documentRef = {
    querySelectorAll(selector: string) {
      if (selector === '[data-competition-period-option]') return [allTime, currentMonth];
      if (selector === '[data-competition-period-link]') return [globalLink];
      if (selector === '[data-competition-return-to]') return [returnTo];
      if (selector === '[data-competition-month-nav]') return [previous, next];
      return [];
    },
    querySelector: () => label,
  };
  const control = initializeCompetitionPeriodControl({
    documentRef,
    locationRef: { pathname: '/arena/us/boulder-745', search },
    historyRef,
    now: () => new Date(2026, 6, 14, 12),
    onChange,
  });
  return { allTime, control, currentMonth, globalLink, historyRef, label, next, onChange, previous, returnTo };
}

describe('competition period control', () => {
  it('defaults to the browser current month and canonicalizes a bare URL', () => {
    const context = setup();

    expect(context.control.period).toBe(CURRENT_MONTH_COMPETITION_PERIOD);
    expect(context.control.month).toBe('2026-07');
    expect(context.currentMonth.isActive()).toBe(true);
    expect(context.label.textContent).toBe('July 2026');
    expect(context.historyRef.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/arena/us/boulder-745?month=2026-07',
    );
  });

  it('uses the URL month and carries it into Global navigation and form returns', () => {
    const context = setup('?month=2026-07');

    expect(context.control.period).toBe(CURRENT_MONTH_COMPETITION_PERIOD);
    expect(context.control.month).toBe('2026-07');
    expect(context.label.textContent).toBe('July 2026');
    expect(context.globalLink.href).toBe('/global?month=2026-07');
    expect(context.returnTo.value).toBe('/arena/us/boulder-745?month=2026-07');
  });

  it('keeps Personal period links on the current map path', () => {
    const allTime = { dataset: { mapPeriodLink: ALL_TIME_COMPETITION_PERIOD }, href: '' };
    const current = { dataset: { mapPeriodLink: CURRENT_MONTH_COMPETITION_PERIOD }, href: '' };
    const context = setup('?month=2026-06');
    const documentRef = {
      querySelectorAll(selector: string) {
        if (selector === '[data-competition-period-option]') return [context.allTime, context.currentMonth];
        if (selector === '[data-map-period-link]') return [allTime, current];
        if (selector === '[data-competition-month-nav]') return [context.previous, context.next];
        return [];
      },
      querySelector: () => context.label,
    };
    initializeCompetitionPeriodControl({
      documentRef,
      locationRef: { pathname: '/personal', search: '?month=2026-06' },
      now: () => new Date(2026, 6, 14, 12),
    });
    expect(allTime.href).toBe('/personal?period=all-time');
    expect(current.href).toBe('/personal?month=2026-06');
  });

  it('writes explicit current-month and all-time states into the URL', async () => {
    const context = setup('?period=all-time');

    await context.currentMonth.click();
    expect(context.control.month).toBe('2026-07');
    expect(context.historyRef.replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/arena/us/boulder-745?month=2026-07',
    );
    expect(context.onChange).toHaveBeenLastCalledWith({ period: 'current-month', month: '2026-07' });

    await context.allTime.click();
    expect(context.control.month).toBeNull();
    expect(context.historyRef.replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/arena/us/boulder-745?period=all-time',
    );
  });

  it('treats an invalid or missing month as the current month and marks all time explicitly', () => {
    expect(competitionMonthFromSearch('?month=2026-13')).toBeNull();
    expect(competitionMonthFromSearch('')).toBeNull();
    expect(competitionPageUrl('/global', null)).toBe('/global?period=all-time');
  });

  it('navigates historical months while preventing future navigation', async () => {
    const context = setup('?month=2026-06');
    expect(context.control.month).toBe('2026-06');
    expect(context.previous.disabled).toBe(false);
    expect(context.next.disabled).toBe(false);
    await context.previous.click();
    expect(context.control.month).toBe('2026-05');
    expect(context.historyRef.replaceState).toHaveBeenLastCalledWith(null, '', '/arena/us/boulder-745?month=2026-05');
    expect(context.onChange).toHaveBeenLastCalledWith({ period: CURRENT_MONTH_COMPETITION_PERIOD, month: '2026-05' });
    await context.next.click();
    expect(context.control.month).toBe('2026-06');
    await context.next.click();
    await context.next.click();
    await context.next.click();
    await context.next.click();
    await context.next.click();
    await context.next.click();
    await context.next.click();
    expect(context.control.month).toBe('2026-07');
    expect(context.next.disabled).toBe(true);
    expect(context.next.attribute('aria-disabled')).toBe('true');
    await context.allTime.click();
    expect(context.previous.hidden).toBe(true);
    expect(context.next.hidden).toBe(true);
  });
});
