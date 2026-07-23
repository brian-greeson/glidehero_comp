import { describe, expect, it } from 'vitest';
import {
  createFlightProcessingControlService,
  SIX_POINT_SOLVER_CONTROL_KEY,
} from '../../src/services/flightProcessingControlService.js';

class FakeValkey {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) {
    this.values.set(key, value);
    return 'OK';
  }
}

describe('FlightProcessingControlService', () => {
  it('defaults a missing persisted setting to enabled', async () => {
    const service = createFlightProcessingControlService(new FakeValkey() as never);

    await expect(service.getSixPointSolverState()).resolves.toBe('enabled');
    await expect(service.isSixPointSolverEnabled()).resolves.toBe(true);
  });

  it('persists enabled and disabled states without startup reset behavior', async () => {
    const valkey = new FakeValkey();
    const first = createFlightProcessingControlService(valkey as never);
    await first.setSixPointSolverState('disabled');

    const second = createFlightProcessingControlService(valkey as never);
    await expect(second.getSixPointSolverState()).resolves.toBe('disabled');
    await expect(second.isSixPointSolverEnabled()).resolves.toBe(false);
    expect(valkey.values.get(SIX_POINT_SOLVER_CONTROL_KEY)).toBe('disabled');

    await second.setSixPointSolverState('enabled');
    await expect(first.getSixPointSolverState()).resolves.toBe('enabled');
  });
});
