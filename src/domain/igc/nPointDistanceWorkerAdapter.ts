import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DistanceCoordinate, NPointDistances } from './distance.js';
import type {
  NPointDistanceWorkerRequest,
  NPointDistanceWorkerResponse,
} from './nPointDistanceWorkerProtocol.js';

export function calculateNPointDistancesInWorker(
  points: readonly DistanceCoordinate[],
): Promise<NPointDistances> {
  return new Promise((resolve, reject) => {
    const request: NPointDistanceWorkerRequest = { points };
    const usesTypeScriptSource = fileURLToPath(import.meta.url).endsWith('.ts');
    const worker = new Worker(
      usesTypeScriptSource
        ? new URL('./nPointDistanceWorker.ts', import.meta.url)
        : new URL('./nPointDistanceWorker.js', import.meta.url),
      {
        workerData: request,
        execArgv: usesTypeScriptSource ? ['--import', 'tsx'] : [],
      },
    );
    let settled = false;

    worker.once('message', (response: NPointDistanceWorkerResponse) => {
      settled = true;
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`N-point distance worker exited with code ${code}.`));
      else if (!settled) reject(new Error('N-point distance worker exited without returning a result.'));
    });
  });
}
