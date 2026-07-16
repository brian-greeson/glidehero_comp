export const DEFAULT_LAUNCH_AREA_GRID_COUNT = 5;

export function parseLaunchAreaGridCount(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LAUNCH_AREA_GRID_COUNT;

  const gridCount = Number(value);
  if (!Number.isInteger(gridCount) || gridCount <= 0 || gridCount % 2 === 0) {
    throw new Error('Grid count must be a positive odd integer.');
  }

  return gridCount;
}

export function parseLaunchAreaCellSize(value: string | undefined): number {
  const cellSize = Number(value);
  if (!Number.isInteger(cellSize) || cellSize <= 0) {
    throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  }

  return cellSize;
}
