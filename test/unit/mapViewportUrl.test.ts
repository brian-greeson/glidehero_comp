import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { mapViewportFromSearch, updateMapModeLinks } from '../../public/scripts/mapViewportUrl.js';

function link(href: string) {
  return {
    href,
    getAttribute(name: string) { return name === 'href' ? href : null; },
  };
}

describe('map viewport URL state', () => {
  it('parses a valid camera and rejects incomplete or out-of-range values', () => {
    expect(mapViewportFromSearch('?lat=39.7392&lng=-104.9903&zoom=11.5')).toEqual({
      center: [-104.9903, 39.7392],
      zoom: 11.5,
    });
    expect(mapViewportFromSearch('?lat=39&lng=-105')).toBeNull();
    expect(mapViewportFromSearch('?lat=91&lng=-105&zoom=7')).toBeNull();
  });

  it('puts the current camera and period on both map mode links', () => {
    const personal = link('/personal');
    const competitive = link('/global');
    updateMapModeLinks({
      documentRef: { querySelectorAll: () => [personal, competitive] },
      locationRef: { origin: 'https://glidehero.test', search: '?month=2026-07' },
      map: {
        getCenter: () => ({ lat: 39.739234, lng: -104.990312 }),
        getZoom: () => 10.678,
      },
    });

    expect(personal.href).toBe('/personal?month=2026-07&lat=39.73923&lng=-104.99031&zoom=10.68');
    expect(competitive.href).toBe('/global?month=2026-07&lat=39.73923&lng=-104.99031&zoom=10.68');
  });

  it('preserves the explicit all-time marker on map mode links', () => {
    const personal = link('/personal');
    const competitive = link('/global');
    updateMapModeLinks({
      documentRef: { querySelectorAll: () => [personal, competitive] },
      locationRef: { origin: 'https://glidehero.test', search: '?period=all-time' },
      map: {
        getCenter: () => ({ lat: 39.739234, lng: -104.990312 }),
        getZoom: () => 10.678,
      },
    });

    expect(personal.href).toContain('/personal?period=all-time');
    expect(competitive.href).toContain('/global?period=all-time');
  });
});
