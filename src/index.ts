import { createServer } from 'node:http';
import { createApp } from './app.js';
import { parseConfig } from './config.js';

const config = parseConfig(process.env);
const server = createServer(createApp());

server.listen(config.port, () => {
  console.log(`GlideHero listening on http://localhost:${config.port}`);
});
