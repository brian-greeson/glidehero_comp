import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeDashboardChrome } from '../../public/scripts/dashboardChrome.js';

describe('dashboard account menu', () => {
  it('saves the territory color when the selection changes', () => {
    const requestSubmit = vi.fn();
    let changeListener: (() => void) | undefined;
    const territoryColorInput = {
      form: { requestSubmit },
      addEventListener(name: string, listener: () => void) {
        if (name === 'change') changeListener = listener;
      },
    };
    const documentRef = {
      querySelector(selector: string) {
        return selector === '[data-territory-color-input]' ? territoryColorInput : null;
      },
    };

    initializeDashboardChrome({ documentRef });
    expect(changeListener).toBeTypeOf('function');

    changeListener?.();

    expect(requestSubmit).toHaveBeenCalledOnce();
  });
});
