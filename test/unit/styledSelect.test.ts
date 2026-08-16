import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeStyledSelects } from '../../public/scripts/app-ui/styledSelect.js';

function element() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const target = new EventTarget() as EventTarget & Record<string, any>;
  Object.assign(target, {
    hidden: false,
    value: '',
    textContent: '',
    dataset: {},
    focus: vi.fn(),
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
    classList: {
      add(name: string) { classes.add(name); },
      remove(name: string) { classes.delete(name); },
      contains(name: string) { return classes.has(name); },
    },
  });
  return target;
}

describe('styled map selects', () => {
  it('opens a styled menu and forwards the chosen value through the native select contract', () => {
    const native = element(); native.value = 'distance';
    const trigger = element(); const value = element(); const menu = element(); menu.hidden = true;
    const distance = element(); distance.dataset.styledSelectOption = 'distance'; distance.querySelector = () => ({ textContent: 'Distance' }); distance.setAttribute('aria-selected', 'true');
    const latest = element(); latest.dataset.styledSelectOption = 'latest'; latest.querySelector = () => ({ textContent: 'Latest' }); latest.setAttribute('aria-selected', 'false');
    const options = [distance, latest];
    const root = element();
    root.querySelector = (selector: string) => ({
      '[data-styled-select-native]': native,
      '[data-styled-select-trigger]': trigger,
      '[data-styled-select-value]': value,
      '[data-styled-select-menu]': menu,
    })[selector];
    root.querySelectorAll = () => options;
    root.contains = (candidate: unknown) => [root, native, trigger, value, menu, ...options].includes(candidate as never);
    const documentRef = element(); documentRef.querySelectorAll = () => [root];
    const changed = vi.fn(); native.addEventListener('change', changed);

    initializeStyledSelects({ documentRef });
    expect(value.textContent).toBe('Distance');
    trigger.dispatchEvent(new Event('click'));
    expect(menu.hidden).toBe(false);
    expect(distance.focus).toHaveBeenCalledOnce();

    latest.dispatchEvent(new Event('click'));
    expect(native.value).toBe('latest');
    expect(value.textContent).toBe('Latest');
    expect(latest.getAttribute('aria-selected')).toBe('true');
    expect(menu.hidden).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });
});
