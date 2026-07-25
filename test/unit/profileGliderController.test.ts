import { describe, expect, it, vi } from 'vitest';
// Browser module is plain JavaScript by design.
// @ts-expect-error No declaration file is needed for the browser controller.
import { initializeProfileLists, requestGliderMatches } from '../../public/scripts/app-ui/profile.js';

class FakeElement {
  hidden = false;
  disabled = false;
  textContent = '';
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners = new Map<string, (event?: any) => void>();
  attributes = new Map<string, string>();

  addEventListener(name: string, listener: (event?: any) => void) {
    this.listeners.set(name, listener);
  }

  dispatch(name: string, event?: any) {
    this.listeners.get(name)?.(event);
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  focus() {}
}

class FakeInput extends FakeElement {
  value = '';
}

class FakeSelect extends FakeElement {
  value = '';
  selectedOptions: Array<{ dataset: Record<string, string> }> = [];

  add(option: FakeElement) {
    this.children.push(option);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function gliderFormFixture() {
  const edit = new FakeElement();
  const form = new FakeElement() as FakeElement & { reset: () => void; elements: { namedItem: () => null } };
  form.hidden = true;
  form.reset = vi.fn();
  form.elements = { namedItem: () => null };
  (form as any).querySelectorAll = () => [];
  const display = new FakeElement();
  const cancel = new FakeElement();
  const modelInput = new FakeInput();
  const results = new FakeElement();
  results.hidden = true;
  (results as any).querySelectorAll = () => [];
  const gliderModelId = new FakeInput();
  const manufacturer = new FakeInput();
  const modelValue = new FakeInput();
  const size = new FakeSelect();
  const rating = new FakeElement();
  const status = new FakeElement();
  const resetConfirmation = new FakeElement();
  const elements = new Map([
    ['[data-glider-edit]', edit],
    ['[data-glider-form]', form],
    ['[data-glider-display]', display],
    ['[data-glider-cancel]', cancel],
    ['[data-glider-model]', modelInput],
    ['[data-glider-results]', results],
    ['[data-glider-model-id]', gliderModelId],
    ['[data-glider-manufacturer]', manufacturer],
    ['[data-glider-model-value]', modelValue],
    ['[data-glider-size]', size],
    ['[data-glider-rating]', rating],
    ['[data-glider-search-status]', status],
    ['[data-glider-reset-confirmation]', resetConfirmation],
  ]);
  const card = { querySelector: (selector: string) => elements.get(selector) ?? null };
  const documentRef = {
    activeElement: null,
    querySelector: (selector: string) => selector === '[data-glider-card]' ? card : null,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
  };
  return { documentRef, modelInput, gliderModelId, size, rating, results, status, cancel };
}

describe('profile glider search controller', () => {
  it('requests an encoded combined fuzzy query and returns the router results', async () => {
    const items = [{ manufacturer: 'Ozone', model: 'Buzz Z7', sizes: [] }];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => items,
    }));

    await expect(requestGliderMatches('Ozon Buz', fetchImpl)).resolves.toEqual(items);
    expect(fetchImpl).toHaveBeenCalledWith('/profile/glider/search?q=Ozon%20Buz', {
      headers: { Accept: 'application/json' },
    });
  });

  it('ignores an in-flight result after the query is cleared', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('HTMLSelectElement', FakeSelect);
    vi.stubGlobal('Option', FakeElement);
    vi.stubGlobal('window', { setTimeout });
    const pending = deferred<{ ok: boolean; json: () => Promise<any[]> }>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const fixture = gliderFormFixture();

    initializeProfileLists(fixture.documentRef as any);
    fixture.modelInput.value = 'Ozone';
    fixture.gliderModelId.value = '00000000-0000-4000-8000-000000000017';
    fixture.modelInput.dispatch('input');
    await vi.advanceTimersByTimeAsync(120);

    fixture.modelInput.value = '';
    fixture.modelInput.dispatch('input');
    pending.resolve({
      ok: true,
      json: async () => [{ manufacturer: 'Ozone', model: 'Buzz Z7', sizes: [] }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.results.hidden).toBe(true);
    expect(fixture.results.children).toHaveLength(0);
    expect(fixture.modelInput.attributes.get('aria-expanded')).toBe('false');
    expect(fixture.gliderModelId.value).toBe('');
    expect(fixture.status.textContent).toBe('');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stores the selected size catalog ID and rating for form submission', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('HTMLSelectElement', FakeSelect);
    const fixture = gliderFormFixture();

    initializeProfileLists(fixture.documentRef as any);
    fixture.size.selectedOptions = [{
      dataset: {
        modelId: '00000000-0000-4000-8000-000000000017',
        rating: 'C',
      },
    }];
    fixture.size.dispatch('change');

    expect(fixture.gliderModelId.value).toBe('00000000-0000-4000-8000-000000000017');
    expect(fixture.rating.textContent).toBe('C');
    vi.unstubAllGlobals();
  });
});
