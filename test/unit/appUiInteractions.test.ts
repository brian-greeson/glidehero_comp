import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeAccountMenu, initializeSegmentedControls, sortFlightRows } from '../../public/scripts/app-ui/app.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapSheet } from '../../public/scripts/app-ui/map.js';

function node() {
  const listeners = new Map<string, (event: any) => void>();
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  return {
    hidden: true,
    dataset: {} as Record<string, string>,
    addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    dispatch(name: string, event: any = {}) { listeners.get(name)?.(event); },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
    attribute(name: string) { return attributes.get(name); },
    focus: vi.fn(),
    contains: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    classList: {
      contains(name: string) { return classes.has(name); },
      toggle(name: string, enabled?: boolean) {
        const next = enabled ?? !classes.has(name);
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
    },
  };
}

describe('refreshed app UI interactions', () => {
  it('sorts reusable flight rows numerically with newest-launch tie breaking', () => {
    const rows = [
      { dataset: { launch: '2', distance: '100', duration: '60' } },
      { dataset: { launch: '3', distance: '200', duration: '30' } },
      { dataset: { launch: '1', distance: '200', duration: '90' } },
    ];
    expect(sortFlightRows(rows, 'distance', 'desc').map((row: (typeof rows)[number]) => row.dataset.launch)).toEqual(['3', '1', '2']);
    expect(sortFlightRows(rows, 'duration', 'asc').map((row: (typeof rows)[number]) => row.dataset.duration)).toEqual(['30', '60', '90']);
  });
  it('opens and dismisses the account menu with Escape', () => {
    const root: any = node();
    const trigger = node();
    const menu = node();
    root.querySelector = (selector: string) => selector === '[data-account-trigger]' ? trigger : menu;
    const listeners = new Map<string, (event: any) => void>();
    const documentRef = {
      querySelector: () => root,
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    };
    initializeAccountMenu(documentRef);
    trigger.dispatch('click');
    expect(menu.hidden).toBe(false);
    expect(trigger.attribute('aria-expanded')).toBe('true');
    listeners.get('keydown')?.({ key: 'Escape' });
    expect(menu.hidden).toBe(true);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it('makes a segmented control single-select', () => {
    const one = node(); const two = node();
    const control = { querySelectorAll: () => [one, two] };
    initializeSegmentedControls({ querySelectorAll: () => [control] });
    two.dispatch('click');
    expect(one.attribute('aria-pressed')).toBe('false');
    expect(two.attribute('aria-pressed')).toBe('true');
  });

  it('moves the mobile map sheet through collapsed, partial, and expanded states', () => {
    const sheet = node(); const handle = node(); const label = { textContent: '' };
    const documentRef = { querySelector(selector: string) {
      if (selector === '[data-map-sheet]') return sheet;
      if (selector === '[data-map-sheet-handle]') return handle;
      return label;
    } };
    initializeMapSheet({ documentRef });
    handle.dispatch('click');
    expect(sheet.classList.contains('is-expanded')).toBe(true);
    handle.dispatch('click');
    handle.dispatch('pointerdown', { button: 0, isPrimary: true, clientY: 180, pointerId: 1 });
    handle.dispatch('pointermove', { clientY: 100 });
    handle.dispatch('pointerup', { clientY: 100 });
    expect(sheet.classList.contains('is-partial')).toBe(true);
    handle.dispatch('pointerdown', { button: 0, isPrimary: true, clientY: 180, pointerId: 1 });
    handle.dispatch('pointermove', { clientY: 100 });
    handle.dispatch('pointerup', { clientY: 100 });
    expect(sheet.classList.contains('is-expanded')).toBe(true);
    expect(label.textContent).toBe('Collapse flight browser');
  });

  it('uses each sheet aria-label in the shared handle text', () => {
    const sheet = node(); const handle = node(); const label = { textContent: '' };
    sheet.setAttribute('aria-label', 'Flight details');
    const documentRef = { querySelector(selector: string) {
      if (selector === '[data-map-sheet]') return sheet;
      if (selector === '[data-map-sheet-handle]') return handle;
      return label;
    } };
    initializeMapSheet({ documentRef });
    expect(label.textContent).toBe('Expand flight details');
    handle.dispatch('click');
    expect(label.textContent).toBe('Collapse flight details');
  });
});
