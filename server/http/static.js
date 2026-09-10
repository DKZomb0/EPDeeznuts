/**
 * Static file serving for local development.
 *
 * On Vercel this code never runs: everything under public/ is served by the
 * edge before a function is invoked. Locally it means `npm start` gives you the
 * whole application on one port with no second process.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = join(here, '..', '..', 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  // normalize() collapses `..` before the join, so a request can never climb
  // out of public/.
  const target = join(PUBLIC_DIR, normalize(relative).replace(/^(\.\.[/\\])+/, ''));

  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) return serveStatic(req, res, `${pathname.replace(/\/$/, '')}/index.html`);

    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=60',
    });
    createReadStream(target).pipe(res);
  } catch {
    // The client uses hash routing, so any unknown path is a typo rather than a
    // deep link that needs rewriting to index.html.
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Niet gevonden');
  }
}
