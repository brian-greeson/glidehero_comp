import { describe, expect, it } from 'vitest';
import { searchGliderModels, type GliderCatalogEntry } from '../../src/domain/glider/catalog.js';

const catalog: GliderCatalogEntry[] = [
  { id: 'zeno-xs', manufacturer: 'Ozone', model: 'Zeno 2', size: 'XS', enRating: 'D' },
  { id: 'buzz-xs', manufacturer: 'Ozone', model: 'Buzz Z7', size: 'XS', enRating: 'B' },
  { id: 'ultralite-13', manufacturer: 'Ozone', model: 'Ultralite 5', size: '13', enRating: 'Uncertified' },
  { id: 'ultralite-17', manufacturer: 'Ozone', model: 'Ultralite 5', size: '17', enRating: 'C' },
  { id: 'ultralite-21', manufacturer: 'Ozone', model: 'Ultralite 5', size: '21', enRating: 'A' },
];

describe('glider catalog', () => {
  it('finds combined make/model searches with misspellings', () => {
    expect(searchGliderModels(catalog, 'Ozon Zeno').slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ manufacturer: 'Ozone', model: 'Zeno 2' }),
    ]));
    expect(searchGliderModels(catalog, 'Ozon Buz')[0]).toMatchObject({
      manufacturer: 'Ozone',
      model: 'Buzz Z7',
    });
  });

  it('keeps each size paired with its authoritative rating', () => {
    const [ultralite] = searchGliderModels(catalog, 'Ozone Ultralite 5');
    expect(ultralite).toMatchObject({
      manufacturer: 'Ozone',
      model: 'Ultralite 5',
      sizes: expect.arrayContaining([
        { id: 'ultralite-13', value: '13', enRating: 'Uncertified' },
        { id: 'ultralite-17', value: '17', enRating: 'C' },
        { id: 'ultralite-21', value: '21', enRating: 'A' },
      ]),
    });
  });
});
