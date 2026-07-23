import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DistanceCoordinate, SixPointDistance } from './distance.js';
import type {
  SixPointDistanceWorkerRequest,
  SixPointDistanceWorkerResponse,
} from './sixPointDistanceWorkerProtocol.js';

export function calculateSixPointDistanceInWorker(
  points: readonly DistanceCoordinate[],
): Promise<SixPointDistance> {
  return new Promise((resolve, reject) => {
    const request: SixPointDistanceWorkerRequest = { points };
    const usesTypeScriptSource = fileURLToPath(import.meta.url).endsWith('.ts');
    const worker = new Worker(
      usesTypeScriptSource
        ? new URL('./sixPointDistanceWorker.ts', import.meta.url)
        : new URL('./sixPointDistanceWorker.js', import.meta.url),
      {
        workerData: request,
        execArgv: usesTypeScriptSource ? ['--import', 'tsx'] : [],
      },
    );
    let settled = false;

    worker.once('message', (response: SixPointDistanceWorkerResponse) => {
      settled = true;
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`Six-point distance worker exited with code ${code}.`));
      else if (!settled) reject(new Error('Six-point distance worker exited without returning a result.'));
    });
  });
}
