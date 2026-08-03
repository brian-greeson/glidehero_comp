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

function result(flights: any[] = []) {
  return {
    cell: {
      type: 'Feature',
      properties: { cellId: '500:1:2', x: 1, y: 2 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-106, 39], [-105, 39], [-105, 40], [-106, 40], [-106, 39]]],
      },
    },
    flights,
  };
}

describe('map cell claimant popup', () => {
  it('renders accessible flight links with pilot, date, distance, and track color', () => {
    Popup.instances = [];
    const documentRef = { createElement: vi.fn(() => element()) };
    const popup = createMapCellClaimantPopup({
      map: {},
      maplibre: { Popup },
      documentRef,
      colorForPilot: (userId: string) => userId === 'alpha' ? '#111111' : '#222222',
    });

    popup.render(result([
      {
        flightId: 'flight-alpha', userId: 'alpha', displayName: 'Alpha Pilot',
        startedAt: '2026-07-04T03:00:00.000Z', launchTimezone: 'America/Denver', distanceMeters: 25_430,
      },
      {
        flightId: 'flight-bravo', userId: 'bravo', displayName: 'Bravo Pilot',
        startedAt: null, launchTimezone: null, distanceMeters: null,
      },
    ]));

    const instance = Popup.instances[0]!;
    expect(instance.options).toMatchObject({
      className: 'cell-claimants-popup',
      maxWidth: '18rem',
    });
    expect(instance.setLngLat).toHaveBeenCalledWith([-105.5, 39.5]);
    const content = instance.setDOMContent.mock.calls[0]![0];
    expect(content.getAttribute('aria-label')).toBe('Flights through this cell');
    const links = content.children[1].children.map((item: any) => item.children[0]);
    expect(links.map((link: any) => link.href)).toEqual([
      '/flights/flight-alpha',
      '/flights/flight-bravo',
    ]);
    expect(links.map((link: any) => link.children[1].children[0].textContent))
      .toEqual(['Alpha Pilot', 'Bravo Pilot']);
    expect(links[0].children[1].children[1].textContent).toBe('Jul 3, 2026 · 25.4 km');
    expect(links[1].children[1].children[1].textContent)
      .toBe('Date unavailable · Distance unavailable');
    expect(links[0].children[0].style.setProperty)
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
    popup.render(result([{
      flightId: 'flight-alpha', userId: 'alpha', displayName: 'Alpha Pilot',
      startedAt: null, launchTimezone: null, distanceMeters: null,
    }]));

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
