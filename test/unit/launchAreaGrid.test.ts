import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAUNCH_AREA_GRID_COUNT,
  parseLaunchAreaCellSize,
  parseLaunchAreaGridCount,
} from '../../src/domain/launch/launchAreaGrid.js';

describe('launch-area grid input', () => {
  it('defaults the grid count to five and accepts positive odd counts', () => {
    expect(parseLaunchAreaGridCount(undefined)).toBe(DEFAULT_LAUNCH_AREA_GRID_COUNT);
    expect(parseLaunchAreaGridCount('5')).toBe(5);
    expect(parseLaunchAreaGridCount('7')).toBe(7);
  });

  it.each(['0', '-1', '2', '4', '1.5', 'not-a-number'])(
    'rejects invalid grid count %s',
    (value) => {
      expect(() => parseLaunchAreaGridCount(value)).toThrow('positive odd integer');
    },
  );

  it('requires a positive integer cell size', () => {
    expect(parseLaunchAreaCellSize('500')).toBe(500);
    expect(() => parseLaunchAreaCellSize(undefined)).toThrow('GRID_CLAIM_CELL_SIZE');
    expect(() => parseLaunchAreaCellSize('0')).toThrow('GRID_CLAIM_CELL_SIZE');
    expect(() => parseLaunchAreaCellSize('500.5')).toThrow('GRID_CLAIM_CELL_SIZE');
  });
});
