import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Group browser module intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeGroupInviteSearch } from '../../public/scripts/app-ui/group.js';

class ElementStub {
  value = '';
  hidden = false;
  id = '';
  type = '';
  textContent = '';
  dataset: Record<string, string> = {};
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event: any) => void>>();
  setCustomValidity = vi.fn();
  reportValidity = vi.fn();
  focus = vi.fn();

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    const dispatched = { preventDefault: vi.fn(), ...event };
    for (const listener of this.listeners.get(type) ?? []) listener(dispatched);
    return dispatched;
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  replaceChildren(...children: ElementStub[]) { this.children = children; }
  querySelectorAll(selector: string) {
    return selector === '[role="option"]'
      ? this.children.filter((child) => child.getAttribute('role') === 'option')
      : [];
  }
}

function harness(fetchImpl = vi.fn()) {
  const form = new ElementStub();
  form.dataset.searchHref = '/v1/groups/group/invite-candidates';
  const search = new ElementStub();
  const userId = new ElementStub();
  const results = new ElementStub();
  const status = new ElementStub();
  const elements = new Map([
    ['[data-group-invite-search]', search],
    ['[data-group-invite-user-id]', userId],
    ['[data-group-invite-results]', results],
    ['[data-group-invite-status]', status],
  ]);
  (form as any).querySelector = (selector: string) => elements.get(selector) ?? null;
  const documentRef = {
    querySelector: (selector: string) => selector === '[data-group-invite-form]' ? form : null,
    createElement: () => new ElementStub(),
  };
  initializeGroupInviteSearch(documentRef as any, fetchImpl);
  return { search, results, status, fetchImpl };
}

describe('Group invite autocomplete', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces consecutive input changes into one search', async () => {
    const context = harness(vi.fn(async () => ({ ok: true, json: async () => [] })));
    context.search.value = 'Br';
    context.search.dispatch('input');
    await vi.advanceTimersByTimeAsync(100);
    context.search.value = 'Brian';
    context.search.dispatch('input');

    await vi.advanceTimersByTimeAsync(199);
    expect(context.fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(context.fetchImpl).toHaveBeenCalledOnce();
    expect(context.fetchImpl).toHaveBeenCalledWith('/v1/groups/group/invite-candidates?q=Brian', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    }));
  });

  it('aborts an in-flight search when the query changes', async () => {
    const fetchImpl = vi.fn((_url: string, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const context = harness(fetchImpl);
    context.search.value = 'Br';
    context.search.dispatch('input');
    await vi.advanceTimersByTimeAsync(200);
    const firstSignal = fetchImpl.mock.calls[0]?.[1]?.signal;

    context.search.value = 'Brian';
    context.search.dispatch('input');
    await Promise.resolve();

    expect(firstSignal?.aborted).toBe(true);
    expect(context.status.textContent).toBe('');
  });

  it('cancels a pending search when Escape dismisses results', async () => {
    const context = harness();
    context.search.value = 'Brian';
    context.search.dispatch('input');
    context.search.dispatch('keydown', { key: 'Escape' });

    await vi.runAllTimersAsync();

    expect(context.fetchImpl).not.toHaveBeenCalled();
    expect(context.results.hidden).toBe(true);
    expect(context.search.getAttribute('aria-expanded')).toBe('false');
  });
});
