import { describe, expect, it } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeProfileLists } from '../../public/scripts/profile.js';

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  hidden = true;
  textContent = 'Show all';
  private readonly listeners = new Map<string, () => void>();

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }

  click() {
    this.listeners.get('click')?.();
  }
}

describe('profile list disclosure', () => {
  it('reveals and collapses a server-rendered profile list', () => {
    const list = new FakeElement();
    const toggle = new FakeElement();
    toggle.setAttribute('aria-controls', 'profile-achievement-list');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.dataset.showAllLabel = 'Show all';
    toggle.dataset.showFewerLabel = 'Show fewer';
    const documentRef = {
      querySelectorAll: () => [toggle],
      getElementById: (id: string) => id === 'profile-achievement-list' ? list : null,
    };

    initializeProfileLists(documentRef);

    expect(list.getAttribute('data-collapsible')).toBe('');
    expect(toggle.hidden).toBe(false);

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Show fewer');
    expect(list.getAttribute('data-expanded')).toBe('');

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('Show all');
    expect(list.getAttribute('data-expanded')).toBeNull();
  });

  it('leaves a toggle hidden when its target list is missing', () => {
    const toggle = new FakeElement();
    toggle.setAttribute('aria-controls', 'missing-list');
    const documentRef = {
      querySelectorAll: () => [toggle],
      getElementById: () => null,
    };

    initializeProfileLists(documentRef);

    expect(toggle.hidden).toBe(true);
  });
});
