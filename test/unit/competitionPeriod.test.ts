import { describe, expect, it, vi } from 'vitest';
// Browser asset intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { ALL_TIME_COMPETITION_PERIOD, CURRENT_MONTH_COMPETITION_PERIOD, competitionMonthFromSearch, competitionPageUrl, initializeCompetitionPeriodControl } from '../../public/scripts/competitionPeriod.js';

function button(period: string) {
  const listeners = new Map<string, () => Promise<void>>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    dataset: { competitionPeriodOption: period },
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
  const historyRef = { replaceState: vi.fn() };
  const onChange = vi.fn();
  const documentRef = {
    querySelectorAll(selector: string) {
      if (selector === '[data-competition-period-option]') return [allTime, currentMonth];
      if (selector === '[data-competition-period-link]') return [globalLink];
      if (selector === '[data-competition-return-to]') return [returnTo];
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
  return { allTime, control, currentMonth, globalLink, historyRef, label, onChange, returnTo };
}

describe('competition period control', () => {
  it('defaults to all time when the URL has no month', () => {
    const context = setup();

    expect(context.control.period).toBe(ALL_TIME_COMPETITION_PERIOD);
    expect(context.control.month).toBeNull();
    expect(context.allTime.isActive()).toBe(true);
    expect(context.label.textContent).toBe('Current Month');
  });

  it('uses the URL month and carries it into Global navigation and form returns', () => {
    const context = setup('?month=2026-07');

    expect(context.control.period).toBe(CURRENT_MONTH_COMPETITION_PERIOD);
    expect(context.control.month).toBe('2026-07');
    expect(context.label.textContent).toBe('July 2026');
    expect(context.globalLink.href).toBe('/global?month=2026-07');
    expect(context.returnTo.value).toBe('/arena/us/boulder-745?month=2026-07');
  });

  it('writes the current browser month into the URL and removes it for all time', async () => {
    const context = setup();

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
    expect(context.historyRef.replaceState).toHaveBeenLastCalledWith(null, '', '/arena/us/boulder-745');
  });

  it('treats an invalid or missing month as all time', () => {
    expect(competitionMonthFromSearch('?month=2026-13')).toBeNull();
    expect(competitionMonthFromSearch('')).toBeNull();
    expect(competitionPageUrl('/global', null)).toBe('/global');
  });
});
