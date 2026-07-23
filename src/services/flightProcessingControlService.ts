import type { GlideClient } from '@valkey/valkey-glide';

export const SIX_POINT_SOLVER_CONTROL_KEY = 'glidehero:flight-processing:six-point-solver';

export type SixPointSolverState = 'enabled' | 'disabled';

export interface FlightProcessingControlService {
  getSixPointSolverState(): Promise<SixPointSolverState>;
  setSixPointSolverState(state: SixPointSolverState): Promise<void>;
  isSixPointSolverEnabled(): Promise<boolean>;
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
  const getSixPointSolverState = async (): Promise<SixPointSolverState> => (
    decode(await valkey.get(SIX_POINT_SOLVER_CONTROL_KEY)) === 'disabled'
      ? 'disabled'
      : 'enabled'
  );

  return {
    getSixPointSolverState,

    async setSixPointSolverState(state) {
      await valkey.set(SIX_POINT_SOLVER_CONTROL_KEY, state);
    },

    async isSixPointSolverEnabled() {
      return (await getSixPointSolverState()) === 'enabled';
    },
  };
}
