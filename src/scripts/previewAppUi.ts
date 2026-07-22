import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { appPageFixture } from '../views/app/fixtures.js';
import { createAppPageRenderer } from '../views/app/appRenderer.js';
import type { AppPage } from '../views/app/models.js';

const port = Number(process.env.UI_PREVIEW_PORT ?? 4174);
const publicRoot = resolve('public');
const render = createAppPageRenderer();
const pages = new Set<AppPage>(['map', 'activity', 'achievements', 'profile']);
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://ui-preview.local').pathname;
  if (pathname === '/') {
    response.writeHead(302, { location: '/map' }).end();
    return;
  }
  const page = pathname.slice(1) as AppPage;
  if (pages.has(page)) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await render(appPageFixture(page)));
    return;
  }
  const file = resolve(publicRoot, `.${pathname}`);
  if (!file.startsWith(`${publicRoot}${sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`GlideHero UI preview: http://127.0.0.1:${port}/map\n`);
});
