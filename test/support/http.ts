import { createServer } from 'node:http';
import type { Express } from 'express';

export async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP.');

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    // Tests do not always need to consume every response body (for example
    // when asserting only a status code). Force those keep-alive connections
    // closed before waiting for the server's close callback so one unconsumed
    // response cannot hang the entire suite.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
