import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { createMapCellClaimantPopup } from '../../public/scripts/mapCellClaimants.js';

function element(): any {
  const attributes = new Map<string, string>();
  return {
    className: '',
    textContent: '',
    children: [] as any[],
    style: { setProperty: vi.fn() },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name);
    },
    append(...children: any[]) {
      this.children.push(...children);
    },
  };
}

class Popup {
  static instances: Popup[] = [];
  handlers = new Map<string, () => void>();
  remove = vi.fn(() => {
    this.handlers.get('close')?.();
  });
  setLngLat = vi.fn((_lngLat: any) => this);
  setDOMContent = vi.fn((_content: any) => this);
  addTo = vi.fn((_map: any) => this);

  constructor(public options: any) {
    Popup.instances.push(this);
  }

  on(name: string, handler: () => void) {
    this.handlers.set(name, handler);
    return this;
  }
}

function result(pilots: any[] = []) {
  return {
    cell: {
      type: 'Feature',
      properties: { cellId: '500:1:2', x: 1, y: 2 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-106, 39], [-105, 39], [-105, 40], [-106, 40], [-106, 39]]],
      },
    },
    pilots,
  };
}

describe('map cell claimant popup', () => {
  it('renders a colored, accessible pilot list at the selected cell center', () => {
    Popup.instances = [];
    const documentRef = { createElement: vi.fn(() => element()) };
    const popup = createMapCellClaimantPopup({
      map: {},
      maplibre: { Popup },
      documentRef,
      colorForPilot: (userId: string) => userId === 'alpha' ? '#111111' : '#222222',
    });

    popup.render(result([
      { userId: 'alpha', displayName: 'Alpha Pilot' },
      { userId: 'bravo', displayName: 'Bravo Pilot' },
    ]));

    const instance = Popup.instances[0]!;
    expect(instance.setLngLat).toHaveBeenCalledWith([-105.5, 39.5]);
    const content = instance.setDOMContent.mock.calls[0]![0];
    expect(content.getAttribute('aria-label')).toBe('Pilots who claimed this cell');
    expect(content.children[1].children.map((item: any) => item.children[1].textContent))
      .toEqual(['Alpha Pilot', 'Bravo Pilot']);
    expect(content.children[1].children[0].children[0].style.setProperty)
      .toHaveBeenCalledWith('--pilot-color', '#111111');
  });

  it('updates in place and clears the selection when the user closes it', () => {
    Popup.instances = [];
    const onClose = vi.fn();
    const popup = createMapCellClaimantPopup({
      map: {},
      maplibre: { Popup },
      documentRef: { createElement: () => element() },
      colorForPilot: () => '#111111',
      onClose,
    });
    popup.render(result());
    popup.render(result([{ userId: 'alpha', displayName: 'Alpha Pilot' }]));

    expect(Popup.instances).toHaveLength(1);
    expect(Popup.instances[0]!.setDOMContent).toHaveBeenCalledTimes(2);

    Popup.instances[0]!.handlers.get('close')?.();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not notify selection close when cleared programmatically', () => {
    Popup.instances = [];
    const onClose = vi.fn();
    const popup = createMapCellClaimantPopup({
      map: {},
      maplibre: { Popup },
      documentRef: { createElement: () => element() },
      colorForPilot: () => '#111111',
      onClose,
    });
    popup.render(result());

    popup.clear();

    expect(Popup.instances[0]!.remove).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
