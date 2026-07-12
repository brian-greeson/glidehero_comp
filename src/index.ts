import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const server = createServer(app);

server.listen(config.port, () => {
  console.log(
    `Glidehero: running in  ${config.isProduction ? 'Production' : 'DevMode'} listening on :${config.port}`,
  );
});
