import type { GlideClient } from '@valkey/valkey-glide';

export const N_POINT_SOLVER_CONTROL_KEY = 'glidehero:flight-processing:n-point-solver';

export type NPointSolverState = 'enabled' | 'disabled';

export interface FlightProcessingControlService {
  getNPointSolverState(): Promise<NPointSolverState>;
  setNPointSolverState(state: NPointSolverState): Promise<void>;
  isNPointSolverEnabled(): Promise<boolean>;
}

function decode(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string'
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value).toString()
      : String(value);
}

export function createFlightProcessingControlService(
  valkey: Pick<GlideClient, 'get' | 'set'>,
): FlightProcessingControlService {
  const getNPointSolverState = async (): Promise<NPointSolverState> => (
    decode(await valkey.get(N_POINT_SOLVER_CONTROL_KEY)) === 'disabled'
      ? 'disabled'
      : 'enabled'
  );

  return {
    getNPointSolverState,

    async setNPointSolverState(state) {
      await valkey.set(N_POINT_SOLVER_CONTROL_KEY, state);
    },

    async isNPointSolverEnabled() {
      return (await getNPointSolverState()) === 'enabled';
    },
  };
}
