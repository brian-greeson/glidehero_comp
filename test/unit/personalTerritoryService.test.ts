import { describe, expect, it, vi } from 'vitest';
import { createPersonalTerritoryService } from '../../src/services/personalTerritoryService.js';

const userId = '00000000-0000-4000-8000-000000000030';

function databaseDouble() {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { database: { select }, select };
}

describe('PersonalTerritoryService', () => {
  it('returns an empty FeatureCollection when no stored projection exists', async () => {
    const { database, select } = databaseDouble();
    const service = createPersonalTerritoryService(database as never);

    await expect(service.get({ userId })).resolves.toEqual({ type: 'FeatureCollection', features: [] });

    expect(select).toHaveBeenCalledOnce();
  });

  it('does not share the empty projection between reads', async () => {
    const { database } = databaseDouble();
    const service = createPersonalTerritoryService(database as never);

    const first = await service.get({ userId });
    const second = await service.get({ userId });

    expect(first).not.toBe(second);
  });
});
