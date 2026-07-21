import { describe, expect, it } from 'vitest';
import { arenaPath, arenaSlug, isCanonicalArenaRoute, normalizeArenaCountryCode, parseArenaSourceId } from '../../src/domain/arena/arenaRoute.js';

describe('arena routes', () => {
  it('builds canonical country, slug, and source-id paths', () => {
    expect(normalizeArenaCountryCode('XK')).toBe('xk');
    expect(arenaSlug('Böulder Ridge & West')).toBe('boulder-ridge-west');
    expect(arenaPath({ sourceId: 745, name: 'Boulder', countryCode: 'US' }))
      .toBe('/arena/us/boulder-745');
  });

  it('uses the final numeric suffix as identity', () => {
    expect(parseArenaSourceId('launch-42-745')).toBe(745);
    expect(parseArenaSourceId('launch')).toBeNull();
    expect(parseArenaSourceId('launch-0')).toBeNull();
  });

  it('validates the complete canonical route', () => {
    const arena = { sourceId: 745, name: 'Boulder', countryCode: 'US' };
    expect(isCanonicalArenaRoute(arena, 'us', 'boulder-745')).toBe(true);
    expect(isCanonicalArenaRoute(arena, 'US', 'boulder-745')).toBe(false);
    expect(isCanonicalArenaRoute(arena, 'ca', 'boulder-745')).toBe(false);
    expect(isCanonicalArenaRoute(arena, 'us', 'wrong-745')).toBe(false);
  });

  it('rejects invalid route country codes', () => {
    expect(() => normalizeArenaCountryCode('Unknown')).toThrow('Invalid ISO country code');
    expect(() => arenaPath({ sourceId: 1, name: 'Test', countryCode: 'USA' })).toThrow('Invalid ISO country code');
    expect(isCanonicalArenaRoute({ sourceId: 1, name: 'Test', countryCode: 'US' }, 'USA', 'test-1')).toBe(false);
  });
});
