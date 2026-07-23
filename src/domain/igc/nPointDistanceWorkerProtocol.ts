import type { DistanceCoordinate, NPointDistances } from './distance.js';

export type NPointDistanceWorkerRequest = {
  points: readonly DistanceCoordinate[];
};

export type NPointDistanceWorkerResponse =
  | { ok: true; result: NPointDistances }
  | { ok: false; error: string };
