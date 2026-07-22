import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { achievementCatalog } from '../../src/domain/achievement/catalog.js';
import { achievementArtworkManifest, resolveAchievementArtworkKey } from '../../src/views/authenticated/achievementArtwork.js';

type DecodedPng = { width: number; height: number; bitDepth: number; colorType: number; interlace: number; pixels: Uint8Array };

function decodePng(path: string): DecodedPng {
  const raw = readFileSync(path);
  expect(raw.subarray(0, 8)).toEqual(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'));
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Buffer[] = [];
  while (offset < raw.length) {
    const length = raw.readUInt32BE(offset);
    const kind = raw.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = raw.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (kind === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8]!;
      colorType = payload[9]!;
      interlace = payload[12]!;
    } else if (kind === 'IDAT') compressed.push(payload);
    else if (kind === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`Unsupported PNG color type: ${colorType}`);
  const stride = width * channels;
  const scanlines = inflateSync(Buffer.concat(compressed));
  const pixels = new Uint8Array(width * height * channels);
  let cursor = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[cursor++]!;
    const current = Uint8Array.from(scanlines.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels]! : 0;
      const up = previous[index]!;
      const upperLeft = index >= channels ? previous[index - channels]! : 0;
      if (filter === 1) current[index] = (current[index]! + left) & 255;
      else if (filter === 2) current[index] = (current[index]! + up) & 255;
      else if (filter === 3) current[index] = (current[index]! + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
        current[index] = (current[index]! + predictor) & 255;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
    }
    pixels.set(current, y * stride);
    previous = current;
  }
  return { width, height, bitDepth, colorType, interlace, pixels };
}

describe('achievement artwork resolver', () => {
  it.each([
    ['unique_cells', 'cell-explorer'],
    ['unique_cells_milestone', 'cell-explorer'],
    ['first_flight_from_launch', 'first-launch'],
    ['launches_visited_3', 'arenas-touched'],
    ['complete_a_launch_arena', 'champion'],
    ['most_launches_tagged_one_flight', 'distance-record'],
    ['took_lead_in_arena', 'top-cell-holder'],
    ['reclaimed_lead_in_arena', 'legend'],
    ['first_cells_in_general_arena', 'first-cell'],
    ['general_arenas_explored_1', 'mapper'],
    ['general_coverage_10', 'mapper'],
    ['states_flown_in_1', 'mapper'],
    ['countries_flown_in_1', 'collector'],
    ['personal_best_total_cells', 'distance-record'],
    ['personal_best_enclosed_cells', 'mapper'],
  ] as const)('maps %s to %s', (achievementKey, artworkKey) => {
    expect(resolveAchievementArtworkKey({ achievementKey })).toBe(artworkKey);
  });

  it('maps every current catalog key to its intended artwork family', () => {
    for (const definition of achievementCatalog) {
      const expected = definition.key.startsWith('launches_visited_')
        ? 'arenas-touched'
        : definition.key.startsWith('general_arenas_explored_') || definition.key.startsWith('general_coverage_')
          ? 'mapper'
          : definition.key.startsWith('states_flown_in_')
            ? 'mapper'
            : definition.key.startsWith('countries_flown_in_')
              ? 'collector'
              : definition.key === 'first_flight_from_launch'
                ? 'first-launch'
                : definition.key === 'complete_a_launch_arena'
                  ? 'champion'
                  : definition.key === 'most_launches_tagged_one_flight'
                    ? 'distance-record'
                    : definition.key === 'took_lead_in_arena'
                      ? 'top-cell-holder'
                      : definition.key === 'reclaimed_lead_in_arena'
                        ? 'legend'
                        : 'first-cell';
      expect(resolveAchievementArtworkKey({ achievementKey: definition.key, achievementType: definition.kind })).toBe(expected);
      expect(achievementArtworkManifest[expected]).toBeTruthy();
    }
  });

  it('maps each progress key and legacy achievement type', () => {
    const progress = {
      unique_cells: 'cell-explorer',
      launches_visited: 'arenas-touched',
      general_arenas_explored: 'mapper',
      general_coverage: 'mapper',
      states_flown_in: 'mapper',
      countries_flown_in: 'collector',
    } as const;
    for (const [key, artwork] of Object.entries(progress)) {
      expect(resolveAchievementArtworkKey({ achievementKey: key })).toBe(artwork);
    }
    expect(resolveAchievementArtworkKey({ achievementType: 'unique_cells_milestone' })).toBe('cell-explorer');
    expect(resolveAchievementArtworkKey({ achievementType: 'personal_best_total_cells' })).toBe('distance-record');
    expect(resolveAchievementArtworkKey({ achievementType: 'personal_best_enclosed_cells' })).toBe('mapper');
  });

  it('uses the type for legacy milestone rows and falls back safely', () => {
    expect(resolveAchievementArtworkKey({ achievementType: 'unique_cells_milestone' })).toBe('cell-explorer');
    expect(resolveAchievementArtworkKey({ achievementKey: 'unknown_legacy_key' })).toBe('milestone');
  });

  it('registers all extracted and reserved assets', () => {
    expect(Object.keys(achievementArtworkManifest)).toHaveLength(19);
    expect(Object.keys(achievementArtworkManifest)).toEqual(expect.arrayContaining([
      'eco-pilot', 'duration-record', 'altitude-record', 'streaker', 'community-player', 'helpful-pilot', 'photo-sharer',
    ]));
    for (const reserved of ['eco-pilot', 'duration-record', 'altitude-record', 'streaker', 'community-player', 'helpful-pilot', 'photo-sharer'] as const) {
      expect(achievementCatalog.some((definition) => resolveAchievementArtworkKey({ achievementKey: definition.key }) === reserved)).toBe(false);
    }
  });

  it('ships exactly 19 normalized, transparent RGBA assets with nonempty artwork', () => {
    const directory = resolve('public/images/app-ui/achievements');
    const files = readdirSync(directory).filter((file) => file.endsWith('.png')).sort();
    const manifestFiles = Object.values(achievementArtworkManifest).map((src) => basename(src)).sort();
    expect(files).toHaveLength(19);
    expect(files).toEqual(manifestFiles);
    for (const file of files) {
      const png = decodePng(resolve(directory, file));
      expect(png).toMatchObject({ width: 256, height: 256, bitDepth: 8, colorType: 6, interlace: 0 });
      const alpha = (x: number, y: number) => png.pixels[(y * png.width + x) * 4 + 3]!;
      expect([alpha(0, 0), alpha(255, 0), alpha(0, 255), alpha(255, 255)]).toEqual([0, 0, 0, 0]);
      for (let coordinate = 0; coordinate < 256; coordinate += 1) {
        expect(alpha(coordinate, 0), `${file} top edge`).toBe(0);
        expect(alpha(coordinate, 255), `${file} bottom edge`).toBe(0);
        expect(alpha(0, coordinate), `${file} left edge`).toBe(0);
        expect(alpha(255, coordinate), `${file} right edge`).toBe(0);
      }
      let opaque = 0;
      for (let index = 3; index < png.pixels.length; index += 4) if (png.pixels[index]! > 0) opaque += 1;
      expect(opaque).toBeGreaterThan(100);
    }
  });
});
