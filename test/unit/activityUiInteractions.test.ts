import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeActivityUi } from '../../public/scripts/app-ui/activity.js';

describe('refreshed Activity interactions', () => {
  it('updates a Thermal button from the JSON response', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const button = {
      disabled: false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getAttribute: vi.fn(() => 'false'),
    };
    const label = { textContent: 'Send a Thermal' };
    const count = { textContent: '2' };
    const status = { textContent: '' };
    const form: any = {
      action: '/activities/activity-id/thermal',
      dataset: {},
      querySelector(selector: string) {
        if (selector === '[data-thermal-button]') return button;
        if (selector === '[data-thermal-label]') return label;
        if (selector === '[data-thermal-count]') return count;
        if (selector === '[data-thermal-status]') return status;
        return null;
      },
    };
    const feed: any = {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ reacted: true, totalCount: 3 }) }));
    initializeActivityUi({ querySelector: () => feed } as any, fetchImpl as any);

    const submit = listeners.get('submit');
    expect(submit).toBeDefined();
    await submit!({ target: { closest: () => form }, preventDefault: vi.fn() });

    expect(fetchImpl).toHaveBeenCalledWith(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
    expect(label.textContent).toBe('Thermal sent');
    expect(count.textContent).toBe('3');
    expect(status.textContent).toBe('Thermal sent.');
  });
});
