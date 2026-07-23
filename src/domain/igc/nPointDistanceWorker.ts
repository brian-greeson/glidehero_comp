import { parentPort, workerData } from 'node:worker_threads';
import { calculateNPointDistances } from './distance.js';
import type {
  NPointDistanceWorkerRequest,
  NPointDistanceWorkerResponse,
} from './nPointDistanceWorkerProtocol.js';

if (!parentPort) throw new Error('N-point distance worker requires a parent port.');

try {
  const request = workerData as NPointDistanceWorkerRequest;
  const response: NPointDistanceWorkerResponse = {
    ok: true,
    result: calculateNPointDistances(request.points),
  };
  parentPort.postMessage(response);
} catch (error) {
  const response: NPointDistanceWorkerResponse = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  parentPort.postMessage(response);
}
