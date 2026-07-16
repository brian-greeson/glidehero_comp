import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeMobileSheet } from '../../public/scripts/mobileSheet.js';

function interactiveElement() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const listeners = new Map<string, (event: any) => void>();
  return {
    textContent: '',
    classList: {
      contains: (name: string) => classes.has(name),
      toggle(name: string, enabled: boolean) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    setPointerCapture: vi.fn(),
    dispatch(name: string, event: any = {}) { listeners.get(name)?.(event); },
    attribute: (name: string) => attributes.get(name),
    hasClass: (name: string) => classes.has(name),
  };
}

function setup() {
  const toggle = interactiveElement();
  const label = interactiveElement();
  const sheet = interactiveElement();
  const documentRef = {
    querySelector(selector: string) {
      if (selector === '[data-sheet-toggle]') return toggle;
      if (selector === '[data-sheet-toggle-label]') return label;
      if (selector === '[data-mobile-sheet]') return sheet;
      return null;
    },
  };
  initializeMobileSheet({ documentRef });
  return { label, sheet, toggle };
}

describe('Mobile dashboard sheet', () => {
  it('toggles by tap and updates its accessible state', () => {
    const { label, sheet, toggle } = setup();
    toggle.dispatch('click');
    expect(sheet.hasClass('is-expanded')).toBe(true);
    expect(toggle.attribute('aria-expanded')).toBe('true');
    expect(label.textContent).toBe('Collapse map information');
    toggle.dispatch('click');
    expect(sheet.hasClass('is-expanded')).toBe(false);
  });

  it('expands upward and collapses downward', () => {
    const { sheet, toggle } = setup();
    toggle.dispatch('pointerdown', { button: 0, clientY: 160, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 100 });
    toggle.dispatch('pointerup', { clientY: 100 });
    expect(sheet.hasClass('is-expanded')).toBe(true);
    toggle.dispatch('pointerdown', { button: 0, clientY: 100, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 160 });
    toggle.dispatch('pointerup', { clientY: 160 });
    expect(sheet.hasClass('is-expanded')).toBe(false);
  });

  it('ignores a short drag and its follow-up click', () => {
    const { sheet, toggle } = setup();
    toggle.dispatch('pointerdown', { button: 0, clientY: 100, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 120 });
    toggle.dispatch('pointerup', { clientY: 120 });
    toggle.dispatch('click');
    expect(sheet.hasClass('is-expanded')).toBe(false);
  });
});
