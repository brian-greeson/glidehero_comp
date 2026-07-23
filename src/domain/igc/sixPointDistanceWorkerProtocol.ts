import type { DistanceCoordinate, SixPointDistance } from './distance.js';

export type SixPointDistanceWorkerRequest = {
  points: readonly DistanceCoordinate[];
};

export type SixPointDistanceWorkerResponse =
  | { ok: true; result: SixPointDistance }
  | { ok: false; error: string };
