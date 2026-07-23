import { describe, expect, it } from 'vitest';
import {
  createFlightProcessingControlService,
  N_POINT_SOLVER_CONTROL_KEY,
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

    await expect(service.getNPointSolverState()).resolves.toBe('enabled');
    await expect(service.isNPointSolverEnabled()).resolves.toBe(true);
  });

  it('does not read the undeployed six-point control key', async () => {
    const valkey = new FakeValkey();
    valkey.values.set('glidehero:flight-processing:six-point-solver', 'disabled');
    const service = createFlightProcessingControlService(valkey as never);

    await expect(service.getNPointSolverState()).resolves.toBe('enabled');
  });

  it('persists enabled and disabled states without startup reset behavior', async () => {
    const valkey = new FakeValkey();
    const first = createFlightProcessingControlService(valkey as never);
    await first.setNPointSolverState('disabled');

    const second = createFlightProcessingControlService(valkey as never);
    await expect(second.getNPointSolverState()).resolves.toBe('disabled');
    await expect(second.isNPointSolverEnabled()).resolves.toBe(false);
    expect(valkey.values.get(N_POINT_SOLVER_CONTROL_KEY)).toBe('disabled');

    await second.setNPointSolverState('enabled');
    await expect(first.getNPointSolverState()).resolves.toBe('enabled');
  });
});
