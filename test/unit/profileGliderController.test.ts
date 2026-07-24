import { describe, expect, it, vi } from 'vitest';
// Browser module is plain JavaScript by design.
// @ts-expect-error No declaration file is needed for the browser controller.
import { requestGliderMatches } from '../../public/scripts/app-ui/profile.js';

describe('profile glider search controller', () => {
  it('requests an encoded combined fuzzy query and returns the router results', async () => {
    const items = [{ manufacturer: 'Ozone', model: 'Buzz Z7', sizes: [] }];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => items,
    }));

    await expect(requestGliderMatches('Ozon Buz', fetchImpl)).resolves.toEqual(items);
    expect(fetchImpl).toHaveBeenCalledWith('/profile/glider/search?q=Ozon%20Buz', {
      headers: { Accept: 'application/json' },
    });
  });
});
