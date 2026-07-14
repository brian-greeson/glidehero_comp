import { describe, expect, it } from 'vitest';
import { resolveLaunchTimeZone } from '../../src/domain/competition/launchTimeZone.js';

describe('resolveLaunchTimeZone', () => {
  it('returns the IANA timezone containing the launch coordinates', () => {
    expect(resolveLaunchTimeZone({ latitude: 40.015, longitude: -105.2705 })).toBe('America/Denver');
    expect(resolveLaunchTimeZone({ latitude: 35.6764, longitude: 139.65 })).toBe('Asia/Tokyo');
  });
});
