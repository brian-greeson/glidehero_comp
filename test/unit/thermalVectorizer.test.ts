import { describe, expect, it } from 'vitest';
import { classifyThermalPixel, vectorizeThermalPixels } from '../../src/domain/thermal/thermalVectorizer.js';

describe('thermal raster vectorization', () => {
  it('classifies the approved relative activity ordering', () => {
    expect(classifyThermalPixel(0, 0, 255, 255)).toBe('dark_blue');
    expect(classifyThermalPixel(0, 255, 255, 255)).toBe('cyan');
    expect(classifyThermalPixel(255, 210, 0, 255)).toBe('yellow_orange');
    expect(classifyThermalPixel(255, 0, 0, 255)).toBe('red');
    expect(classifyThermalPixel(255, 0, 0, 0)).toBeNull();
  });

  it('drops isolated noise and returns georeferenced connected areas', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (const index of [0, 1, 4, 5]) rgba.set([255, 0, 0, 255], index * 4);
    rgba.set([0, 255, 255, 255], 15 * 4);
    const components = vectorizeThermalPixels({ rgba, width: 4, height: 4, zoom: 12, tileX: 2144, tmsY: 1378 });
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ activityBand: 'red', relativeScore: 1, pixelCount: 4 });
    expect(components[0]?.geometry.type).toBe('MultiPolygon');
  });
});
