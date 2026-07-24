import { describe, expect, it } from 'vitest';
import { findGlider, searchGliderModels } from '../../src/domain/glider/catalog.js';

describe('glider catalog', () => {
  it('finds combined make/model searches with misspellings', () => {
    expect(searchGliderModels('Ozon Zeno').slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ manufacturer: 'Ozone', model: 'Zeno 2' }),
    ]));
    expect(searchGliderModels('Ozon Buz')[0]).toMatchObject({
      manufacturer: 'Ozone',
      model: 'Buzz Z7',
    });
  });

  it('keeps each size paired with its authoritative rating', () => {
    const [ultralite] = searchGliderModels('Ozone Ultralite 5');
    expect(ultralite).toMatchObject({
      manufacturer: 'Ozone',
      model: 'Ultralite 5',
      sizes: expect.arrayContaining([
        { value: '13', enRating: 'Uncertified' },
        { value: '17', enRating: 'C' },
        { value: '21', enRating: 'A' },
      ]),
    });
    expect(findGlider('Ozone', 'Ultralite 5', '17')).toMatchObject({ enRating: 'C' });
    expect(findGlider('Ozone', 'Ultralite 5', '99')).toBeNull();
  });
});
