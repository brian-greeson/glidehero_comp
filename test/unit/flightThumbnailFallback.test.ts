import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser bundle has no TypeScript declaration file.
import { initializeFlightThumbnailFallback } from '../../public/scripts/app-ui/app.js';

function image({ complete, naturalWidth }: { complete: boolean; naturalWidth: number }) {
  const source = { remove: vi.fn() };
  const value = {
    complete,
    naturalWidth,
    dataset: {} as Record<string, string>,
    src: 'signed-thumbnail.webp',
    parentElement: { querySelector: vi.fn(() => source) },
    closest: vi.fn(() => value),
  };
  return { value, source };
}

describe('flight thumbnail fallback behavior', () => {
  it('repairs already-broken images during initialization and delegated errors', () => {
    const early = image({ complete: true, naturalWidth: 0 });
    const later = image({ complete: false, naturalWidth: 0 });
    const addEventListener = vi.fn();
    const documentRef = {
      addEventListener,
      querySelectorAll: vi.fn(() => [early.value, later.value]),
    };

    initializeFlightThumbnailFallback(documentRef as never);

    expect(early.value.src).toBe('/flight-thumbnail-fallback.webp');
    expect(early.source.remove).toHaveBeenCalledOnce();
    expect(later.value.src).toBe('signed-thumbnail.webp');
    const handleError = addEventListener.mock.calls[0]?.[1] as (event: { target: typeof later.value }) => void;
    handleError({ target: later.value });
    expect(later.value.src).toBe('/flight-thumbnail-fallback.webp');
    expect(later.source.remove).toHaveBeenCalledOnce();
    handleError({ target: later.value });
    expect(later.source.remove).toHaveBeenCalledOnce();
  });
});
