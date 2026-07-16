import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Arena browser module intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeArenaSearch } from '../../public/scripts/arenaSearch.js';

class ElementStub {
  value = '';
  hidden = false;
  id = '';
  className = '';
  textContent = '';
  type = '';
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event: any) => void>>();

  get childNodes() {
    return this.children;
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    const dispatched = { preventDefault: vi.fn(), relatedTarget: null, ...event };
    for (const listener of this.listeners.get(type) ?? []) listener(dispatched);
    return dispatched;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  append(...elements: ElementStub[]) {
    this.children.push(...elements);
  }

  replaceChildren(...elements: ElementStub[]) {
    this.children = [...elements];
  }

  querySelectorAll(selector: string) {
    return selector === '[role="option"]'
      ? this.children.filter((child) => child.getAttribute('role') === 'option')
      : [];
  }

  contains(target: unknown) {
    return target === this || this.children.includes(target as ElementStub);
  }

  scrollIntoView() {}
}

function harness(fetchImpl = vi.fn()) {
  const root = new ElementStub();
  const input = new ElementStub();
  const results = new ElementStub();
  root.children = [input, results];
  root.contains = (target) => target === root || target === input || target === results || results.children.includes(target as ElementStub);
  const documentRef = {
    querySelector(selector: string) {
      if (selector === '[data-arena-search]') return root;
      if (selector === '[data-arena-search-input]') return input;
      if (selector === '[data-arena-search-results]') return results;
      return null;
    },
    createElement() {
      return new ElementStub();
    },
  };
  const navigate = vi.fn();
  initializeArenaSearch({ documentRef, fetchImpl, navigate, debounceMs: 200 });
  return { root, input, results, fetchImpl, navigate };
}

function response(arenas: unknown[]) {
  return { ok: true, json: async () => ({ arenas }) };
}

const arenas = [
  { name: 'Alpha', city: 'One', state: 'Colorado', country: 'United States', path: '/arena/us/alpha-1' },
  { name: 'Bravo', city: 'Two', state: 'Colorado', country: 'United States', path: '/arena/us/bravo-2' },
  { name: 'Charlie', city: 'Three', state: 'Colorado', country: 'United States', path: '/arena/us/charlie-3' },
];

describe('Arena autocomplete', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancels a debounced search when Escape dismisses the results', async () => {
    const context = harness(vi.fn());
    context.input.value = 'Boulder';
    context.input.dispatch('input');
    context.input.dispatch('keydown', { key: 'Escape' });

    await vi.runAllTimersAsync();

    expect(context.fetchImpl).not.toHaveBeenCalled();
    expect(context.results.hidden).toBe(true);
    expect(context.input.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['Escape', 'focusout'])('ignores an in-flight response after %s dismissal', async (dismissal) => {
    let resolveFetch!: (value: unknown) => void;
    const fetchImpl = vi.fn((_url: string, options: { signal?: AbortSignal }) => {
      return new Promise((resolve) => {
        resolveFetch = resolve;
        expect(options.signal?.aborted).toBe(false);
      });
    });
    const context = harness(fetchImpl);
    context.input.value = 'Boulder';
    context.input.dispatch('input');
    await vi.advanceTimersByTimeAsync(200);

    if (dismissal === 'Escape') context.input.dispatch('keydown', { key: 'Escape' });
    else context.root.dispatch('focusout', { relatedTarget: null });
    const signal = fetchImpl.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);

    resolveFetch(response(arenas));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.results.hidden).toBe(true);
    expect(context.results.children).toHaveLength(0);
  });

  it('selects the last result on initial Arrow-Up and wraps in both directions', async () => {
    const context = harness(vi.fn(async () => response(arenas)));
    context.input.value = 'a';
    context.input.dispatch('input');
    await vi.advanceTimersByTimeAsync(200);

    context.input.dispatch('keydown', { key: 'ArrowUp' });
    expect(context.results.children[2]?.getAttribute('aria-selected')).toBe('true');

    context.input.dispatch('keydown', { key: 'ArrowUp' });
    expect(context.results.children[1]?.getAttribute('aria-selected')).toBe('true');

    context.input.dispatch('keydown', { key: 'ArrowDown' });
    expect(context.results.children[2]?.getAttribute('aria-selected')).toBe('true');

    context.input.dispatch('keydown', { key: 'ArrowDown' });
    expect(context.results.children[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('selects the first result on initial Arrow-Down and navigates with Enter', async () => {
    const context = harness(vi.fn(async () => response(arenas)));
    context.input.value = 'a';
    context.input.dispatch('input');
    await vi.advanceTimersByTimeAsync(200);

    context.input.dispatch('keydown', { key: 'ArrowDown' });
    expect(context.results.children[0]?.getAttribute('aria-selected')).toBe('true');

    const enter = context.input.dispatch('keydown', { key: 'Enter' });
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(context.navigate).toHaveBeenCalledWith('/arena/us/alpha-1');
  });
});
