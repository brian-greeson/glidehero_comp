import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeActivityUi } from '../../public/scripts/app-ui/activity.js';

describe('refreshed Activity interactions', () => {
  it('clears the selected onboarding step when instructions close', () => {
    const dialogListeners = new Map<string, () => void>();
    const closeListeners = new Map<string, () => void>();
    const dialog: any = {
      open: false,
      showModal() { this.open = true; },
      close() { this.open = false; dialogListeners.get('close')?.(); },
      addEventListener(name: string, listener: () => void) { dialogListeners.set(name, listener); },
    };
    const close: any = { addEventListener(name: string, listener: () => void) { closeListeners.set(name, listener); } };
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { href: 'https://glidehero.test/activity?scope=yours&onboardingStep=history' },
      history: { replaceState },
    });
    initializeActivityUi({
      querySelector(selector: string) {
        if (selector === '[data-onboarding-dialog]') return dialog;
        if (selector === '[data-onboarding-dialog-close]') return close;
        return null;
      },
      querySelectorAll: () => [],
    } as any, vi.fn() as any);

    expect(dialog.open).toBe(true);
    closeListeners.get('click')?.();

    expect(dialog.open).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/activity?scope=yours');
    vi.unstubAllGlobals();
  });

  it('does not reopen an old first-flight result when only history progress changes', async () => {
    const timers: Array<() => Promise<void>> = [];
    const assign = vi.fn();
    const reload = vi.fn();
    const card: any = {
      dataset: { poll: 'true', statusKey: '3:completed:processing', firstFlightComplete: 'true' },
      isConnected: false,
      querySelector: () => null,
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('window', {
      setTimeout(callback: () => Promise<void>) { timers.push(callback); },
      location: { assign, reload },
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ onboarding: {
        statusKey: '4:completed:completed',
        steps: [{ key: 'first-flight', complete: true, href: '/flights/first-flight-id' }],
      } }),
    }));
    initializeActivityUi({
      querySelector: (selector: string) => selector === '[data-onboarding-card]' ? card : null,
      querySelectorAll: () => [],
    } as any, fetchImpl as any);

    expect(timers).toHaveLength(1);
    await timers[0]!();

    expect(assign).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('updates a Like button from the JSON response', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const button = {
      disabled: false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getAttribute: vi.fn(() => 'false'),
    };
    const label = { textContent: 'Send a Like' };
    const count = { textContent: '2' };
    const status = { textContent: '' };
    const form: any = {
      action: '/activities/activity-id/like',
      dataset: {},
      querySelector(selector: string) {
        if (selector === '[data-like-button]') return button;
        if (selector === '[data-like-label]') return label;
        if (selector === '[data-like-count]') return count;
        if (selector === '[data-like-status]') return status;
        return null;
      },
    };
    const feed: any = {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ reacted: true, totalCount: 3 }) }));
    initializeActivityUi({ querySelector: (selector: string) => selector === '[data-activity-feed]' ? feed : null } as any, fetchImpl as any);

    const submit = listeners.get('submit');
    expect(submit).toBeDefined();
    await submit!({ target: { closest: () => form }, preventDefault: vi.fn() });

    expect(fetchImpl).toHaveBeenCalledWith(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
    expect(label.textContent).toBe('Like sent');
    expect(count.textContent).toBe('3');
    expect(status.textContent).toBe('Like sent.');
  });

  it('switches the server-rendered statistics panels without changing the URL', () => {
    const listeners = new Map<string, (event: any) => void>();
    const monthlyButton: any = {
      dataset: { activityStatsButton: 'monthly' },
      setAttribute: vi.fn(),
    };
    const dailyButton: any = {
      dataset: { activityStatsButton: 'daily' },
      setAttribute: vi.fn(),
    };
    const monthlyPanel: any = { dataset: { activityStatsPanel: 'monthly' }, hidden: false };
    const dailyPanel: any = { dataset: { activityStatsPanel: 'daily' }, hidden: true };
    const statistics: any = {
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
      querySelectorAll(selector: string) {
        if (selector === '[data-activity-stats-button]') return [monthlyButton, dailyButton];
        if (selector === '[data-activity-stats-panel]') return [monthlyPanel, dailyPanel];
        return [];
      },
    };
    initializeActivityUi({
      querySelector: (selector: string) => selector === '[data-activity-stats]' ? statistics : null,
    } as any, vi.fn() as any);

    listeners.get('click')!({ target: { closest: () => dailyButton } });

    expect(monthlyButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'false');
    expect(dailyButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
    expect(monthlyPanel.hidden).toBe(true);
    expect(dailyPanel.hidden).toBe(false);
  });
});
