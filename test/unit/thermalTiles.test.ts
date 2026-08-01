import { describe, expect, it } from 'vitest';
import { assertThermalTileCoordinate, isPng, thermalRasterObjectKey, xyzYToTmsY } from '../../src/domain/thermal/thermalTiles.js';

describe('thermal tile domain', () => {
  it('uses the dedicated thermal_tiles bucket prefix and upstream TMS coordinates', () => {
    expect(thermalRasterObjectKey('glidehero-production', { zoom: 12, x: 2144, tmsY: 1378 }))
      .toBe('glidehero-production/thermal_tiles/thermals_all_all/12/2144/1378.png');
    expect(xyzYToTmsY(12, 2717)).toBe(1378);
  });

  it('rejects out-of-range coordinates and validates PNG signatures', () => {
    expect(() => assertThermalTileCoordinate({ zoom: 13, x: 0, tmsY: 0 })).toThrow();
    expect(() => assertThermalTileCoordinate({ zoom: 2, x: 4, tmsY: 0 })).toThrow();
    expect(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(isPng(Uint8Array.from([1, 2, 3]))).toBe(false);
  });
});
