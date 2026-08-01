export type ThermalActivityBand = 'dark_blue' | 'cyan' | 'yellow_orange' | 'red';

export const thermalBandScores: Readonly<Record<ThermalActivityBand, number>> = {
  dark_blue: 0.25,
  cyan: 0.5,
  yellow_orange: 0.75,
  red: 1,
};

export type ThermalVectorComponent = {
  componentIndex: number;
  activityBand: ThermalActivityBand;
  relativeScore: number;
  pixelCount: number;
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
};

function rgbToHue(r: number, g: number, b: number): { hue: number; saturation: number; value: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
    else hue = 60 * (((red - green) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
}

/** Classify the visible Thermal.kk palette into relative, non-probabilistic activity bands. */
export function classifyThermalPixel(r: number, g: number, b: number, alpha: number): ThermalActivityBand | null {
  if (alpha < 32) return null;
  const { hue, saturation, value } = rgbToHue(r, g, b);
  if (saturation < 0.45 || value < 0.18) return null;
  if (hue < 22 || hue >= 340) return 'red';
  if (hue < 85) return 'yellow_orange';
  if (hue < 210) return 'cyan';
  if (hue < 285) return 'dark_blue';
  return null;
}

function pixelLongitude(zoom: number, tileX: number, width: number, pixelX: number): number {
  return ((tileX * width + pixelX) / (2 ** zoom * width)) * 360 - 180;
}

function pixelLatitude(zoom: number, tmsY: number, height: number, pixelY: number): number {
  const xyzY = (2 ** zoom) - tmsY - 1;
  const normalized = (xyzY * height + pixelY) / (2 ** zoom * height);
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * normalized))) * 180) / Math.PI;
}

type Pixel = { x: number; y: number };

function componentRectangles(pixels: readonly Pixel[]): Array<{ x0: number; x1: number; y0: number; y1: number }> {
  const rows = new Map<number, number[]>();
  for (const pixel of pixels) {
    const xs = rows.get(pixel.y) ?? [];
    xs.push(pixel.x);
    rows.set(pixel.y, xs);
  }
  const rectangles: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const active = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  for (const y of sortedRows) {
    const xs = rows.get(y)!.sort((a, b) => a - b);
    const runs: Array<{ x0: number; x1: number }> = [];
    let start = xs[0]!;
    let end = start;
    for (const x of xs.slice(1)) {
      if (x === end + 1) end = x;
      else {
        runs.push({ x0: start, x1: end + 1 });
        start = end = x;
      }
    }
    runs.push({ x0: start, x1: end + 1 });
    const present = new Set<string>();
    for (const run of runs) {
      const key = `${run.x0}:${run.x1}`;
      present.add(key);
      const previous = active.get(key);
      if (previous && previous.y1 === y) previous.y1 = y + 1;
      else active.set(key, { ...run, y0: y, y1: y + 1 });
    }
    for (const [key, rectangle] of active) {
      if (!present.has(key) && rectangle.y1 <= y) {
        rectangles.push(rectangle);
        active.delete(key);
      }
    }
  }
  rectangles.push(...active.values());
  return rectangles;
}

export function vectorizeThermalPixels(input: {
  rgba: Uint8Array;
  width: number;
  height: number;
  zoom: number;
  tileX: number;
  tmsY: number;
  minimumComponentPixels?: number;
}): ThermalVectorComponent[] {
  if (input.rgba.byteLength !== input.width * input.height * 4) throw new RangeError('Thermal raster must contain RGBA pixels.');
  const bands: Array<ThermalActivityBand | null> = new Array(input.width * input.height).fill(null);
  for (let index = 0; index < bands.length; index += 1) {
    const offset = index * 4;
    bands[index] = classifyThermalPixel(input.rgba[offset]!, input.rgba[offset + 1]!, input.rgba[offset + 2]!, input.rgba[offset + 3]!);
  }
  const visited = new Uint8Array(bands.length);
  const minimumPixels = input.minimumComponentPixels ?? 4;
  const output: ThermalVectorComponent[] = [];
  const componentCounts = new Map<ThermalActivityBand, number>();
  for (let start = 0; start < bands.length; start += 1) {
    const band = bands[start];
    if (!band || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    const pixels: Pixel[] = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]!;
      const x = index % input.width;
      const y = Math.floor(index / input.width);
      pixels.push({ x, y });
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < input.width ? index + 1 : -1,
        y > 0 ? index - input.width : -1,
        y + 1 < input.height ? index + input.width : -1,
      ]) {
        if (neighbor >= 0 && !visited[neighbor] && bands[neighbor] === band) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    if (pixels.length < minimumPixels) continue;
    const rectangles = componentRectangles(pixels);
    const coordinates = rectangles.map((rectangle) => [[
      [pixelLongitude(input.zoom, input.tileX, input.width, rectangle.x0), pixelLatitude(input.zoom, input.tmsY, input.height, rectangle.y0)],
      [pixelLongitude(input.zoom, input.tileX, input.width, rectangle.x1), pixelLatitude(input.zoom, input.tmsY, input.height, rectangle.y0)],
      [pixelLongitude(input.zoom, input.tileX, input.width, rectangle.x1), pixelLatitude(input.zoom, input.tmsY, input.height, rectangle.y1)],
      [pixelLongitude(input.zoom, input.tileX, input.width, rectangle.x0), pixelLatitude(input.zoom, input.tmsY, input.height, rectangle.y1)],
      [pixelLongitude(input.zoom, input.tileX, input.width, rectangle.x0), pixelLatitude(input.zoom, input.tmsY, input.height, rectangle.y0)],
    ]]);
    const componentIndex = componentCounts.get(band) ?? 0;
    componentCounts.set(band, componentIndex + 1);
    output.push({
      componentIndex,
      activityBand: band,
      relativeScore: thermalBandScores[band],
      pixelCount: pixels.length,
      geometry: { type: 'MultiPolygon', coordinates },
    });
  }
  return output;
}
