export const THERMAL_SOURCE_LAYER = 'thermals_all_all';
export const THERMAL_NATIVE_ZOOM = 12;
export const THERMAL_PROCESSING_VERSION = 1;
export const THERMAL_MAX_TILE_BYTES = 5 * 1024 * 1024;

export type ThermalTileCoordinate = {
  zoom: number;
  x: number;
  tmsY: number;
};

export function assertThermalTileCoordinate(input: ThermalTileCoordinate): void {
  if (!Number.isInteger(input.zoom) || input.zoom < 0 || input.zoom > THERMAL_NATIVE_ZOOM) {
    throw new RangeError(`Thermal tile zoom must be between 0 and ${THERMAL_NATIVE_ZOOM}.`);
  }
  const width = 2 ** input.zoom;
  if (!Number.isInteger(input.x) || input.x < 0 || input.x >= width) throw new RangeError('Thermal tile X is outside the selected zoom.');
  if (!Number.isInteger(input.tmsY) || input.tmsY < 0 || input.tmsY >= width) throw new RangeError('Thermal tile Y is outside the selected zoom.');
}

export function thermalRasterObjectKey(bucketFolder: string, input: ThermalTileCoordinate, sourceLayerKey = THERMAL_SOURCE_LAYER): string {
  assertThermalTileCoordinate(input);
  const prefix = bucketFolder.replace(/^\/+|\/+$/g, '');
  if (!prefix) throw new RangeError('Thermal tile bucket folder is required.');
  return `${prefix}/thermal_tiles/${sourceLayerKey}/${input.zoom}/${input.x}/${input.tmsY}.png`;
}

export function isPng(buffer: Uint8Array): boolean {
  return buffer.byteLength >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

export function xyzYToTmsY(zoom: number, xyzY: number): number {
  return (2 ** zoom) - xyzY - 1;
}
