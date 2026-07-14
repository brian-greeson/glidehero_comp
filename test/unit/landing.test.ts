import { describe, expect, it, vi } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeLandingAuth } from '../../public/scripts/landing.js';

type Handler = (event: { key?: string; preventDefault: () => void }) => void;

class FakeElement {
  attributes = new Map<string, string>();
  classList = { add: vi.fn() };
  dataset: Record<string, string> = {};
  hidden = false;
  tabIndex = 0;
  listeners = new Map<string, Handler[]>();
  focus = vi.fn();

  addEventListener(type: string, handler: Handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  dispatch(type: string, key?: string) {
    const event = { key, preventDefault: vi.fn() };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
}

function createFixture(initial = 'login', reveal = false) {
  const loginTab = new FakeElement();
  loginTab.dataset.authTab = 'login';
  const signupTab = new FakeElement();
  signupTab.dataset.authTab = 'signup';
  const loginPanel = new FakeElement();
  loginPanel.dataset.authPanel = 'login';
  const signupPanel = new FakeElement();
  signupPanel.dataset.authPanel = 'signup';
  const loginSwitch = new FakeElement();
  loginSwitch.dataset.authSwitch = 'login';
  const signupSwitch = new FakeElement();
  signupSwitch.dataset.authSwitch = 'signup';
  const landing = new FakeElement() as FakeElement & { querySelectorAll: (selector: string) => FakeElement[] };
  landing.dataset.authInitial = initial;
  if (reveal) landing.attributes.set('data-auth-reveal', '');
  landing.querySelectorAll = (selector) => ({
    '[data-auth-tab]': [loginTab, signupTab],
    '[data-auth-panel]': [loginPanel, signupPanel],
    '[data-auth-switch]': [loginSwitch, signupSwitch],
  })[selector] ?? [];
  const documentRef = { querySelector: () => landing };

  return { documentRef, landing, loginTab, signupTab, loginPanel, signupPanel, loginSwitch, signupSwitch };
}

describe('landing authentication panel controller', () => {
  it('activates the server-selected signup panel', () => {
    const fixture = createFixture('signup');

    initializeLandingAuth({ documentRef: fixture.documentRef });

    expect(fixture.landing.classList.add).toHaveBeenCalledWith('auth-enhanced');
    expect(fixture.loginPanel.hidden).toBe(true);
    expect(fixture.signupPanel.hidden).toBe(false);
    expect(fixture.signupTab.attributes.get('aria-selected')).toBe('true');
    expect(fixture.loginTab.tabIndex).toBe(-1);
  });

  it('switches modes from the inline account prompt and focuses the selected tab', () => {
    const fixture = createFixture();
    initializeLandingAuth({ documentRef: fixture.documentRef });

    fixture.signupSwitch.dispatch('click');

    expect(fixture.signupPanel.hidden).toBe(false);
    expect(fixture.loginPanel.hidden).toBe(true);
    expect(fixture.signupTab.focus).toHaveBeenCalledOnce();
  });

  it('supports arrow-key tab navigation', () => {
    const fixture = createFixture();
    initializeLandingAuth({ documentRef: fixture.documentRef });

    const event = fixture.loginTab.dispatch('keydown', 'ArrowRight');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.signupTab.focus).toHaveBeenCalledOnce();
    expect(fixture.signupPanel.hidden).toBe(false);
  });

  it('shows login by default on mobile and keeps both account buttons available', () => {
    const fixture = createFixture();
    initializeLandingAuth({ documentRef: fixture.documentRef, mobileQuery: { matches: true } });

    expect(fixture.loginPanel.hidden).toBe(false);
    expect(fixture.signupPanel.hidden).toBe(true);
    expect(fixture.loginTab.attributes.get('aria-selected')).toBe('true');
    expect(fixture.signupTab.attributes.get('aria-selected')).toBe('false');

    fixture.signupTab.dispatch('click');

    expect(fixture.loginPanel.hidden).toBe(true);
    expect(fixture.signupPanel.hidden).toBe(false);
  });

  it('reveals a server-selected error form immediately on mobile', () => {
    const fixture = createFixture('signup', true);
    initializeLandingAuth({ documentRef: fixture.documentRef, mobileQuery: { matches: true } });

    expect(fixture.signupPanel.hidden).toBe(false);
    expect(fixture.loginPanel.hidden).toBe(true);
    expect(fixture.signupTab.attributes.get('aria-selected')).toBe('true');
  });
});
