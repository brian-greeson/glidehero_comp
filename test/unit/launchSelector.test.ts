import { describe, expect, it } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { launchOptionsUrl, launchSecondaryLabel, normalizeLaunchOption } from '../../public/scripts/app-ui/launchSelector.js';

describe('launch selector browser contracts', () => {
  it('builds viewport and global search URLs as mutually exclusive modes', () => {
    const viewport = new URL(launchOptionsUrl('/v1/map-launches/options', {
      viewport: { west: -106, south: 39, east: -105, north: 40 },
    }), 'https://example.test');
    expect(Object.fromEntries(viewport.searchParams)).toEqual({
      west: '-106', south: '39', east: '-105', north: '40',
    });

    const search = new URL(launchOptionsUrl('/v1/map-launches/options', { query: '  Wood  ' }), 'https://example.test');
    expect(Object.fromEntries(search.searchParams)).toEqual({ q: 'Wood' });
  });

  it('rejects incomplete and non-finite viewport values', () => {
    expect(() => launchOptionsUrl('/options', { viewport: { west: 1, south: 2, east: 3 } })).toThrow(/north/);
    expect(() => launchOptionsUrl('/options')).toThrow(/query or viewport/);
  });

  it('normalizes valid server options and rejects malformed options', () => {
    expect(normalizeLaunchOption({
      launchId: '42', name: ' Woodrat ', state: ' Oregon ', country: ' US ', longitude: '-123.4', latitude: '42.1',
    })).toEqual({ launchId: 42, name: 'Woodrat', state: 'Oregon', country: 'US', longitude: -123.4, latitude: 42.1 });
    expect(normalizeLaunchOption({ launchId: 0, name: 'Bad', longitude: 1, latitude: 2 })).toBeNull();
    expect(normalizeLaunchOption({ launchId: 1, name: '', longitude: 1, latitude: 2 })).toBeNull();
  });

  it('formats state and country as concise secondary context', () => {
    expect(launchSecondaryLabel({ state: 'Colorado', country: 'United States' })).toBe('Colorado, United States');
    expect(launchSecondaryLabel({ state: '', country: 'France' })).toBe('France');
  });
});
