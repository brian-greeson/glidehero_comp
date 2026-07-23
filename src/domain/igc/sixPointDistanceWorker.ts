import { parentPort, workerData } from 'node:worker_threads';
import { calculateSixPointDistance } from './distance.js';
import type {
  SixPointDistanceWorkerRequest,
  SixPointDistanceWorkerResponse,
} from './sixPointDistanceWorkerProtocol.js';

if (!parentPort) throw new Error('Six-point distance worker requires a parent port.');

try {
  const request = workerData as SixPointDistanceWorkerRequest;
  const response: SixPointDistanceWorkerResponse = {
    ok: true,
    result: calculateSixPointDistance(request.points),
  };
  parentPort.postMessage(response);
} catch (error) {
  const response: SixPointDistanceWorkerResponse = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  parentPort.postMessage(response);
}
