/**
 * Local entry point: `npm start`.
 *
 * Serves both the API and the client from one port, so a demo needs nothing but
 * a Node 22 binary and this checkout.
 */
import { createServer } from 'node:http';
import { handleRequest } from './http/app.js';
import { ready, driverName, close } from './db/index.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createServer((req, res) => {
  handleRequest(req, res, { serveAssets: true }).catch((err) => {
    console.error('[epd] unhandled', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Interne fout.' } }));
  });
});

// Bewust niet afbreken bij een mislukte opstart: de server start toch, zodat
// /api/health en het diagnosescherm kunnen zeggen wát er misgaat. Zonder dat
// blijft er alleen een regel in een terminal over die niemand meer openheeft.
try {
  await ready();
  console.log(`[epd] database: ${driverName()}`);
} catch (err) {
  console.error(`[epd] de databank kon niet geïnitialiseerd worden: ${err.message}`);
  console.error('[epd] de server start wel; open /api/health voor de volledige diagnose.');
}

server.listen(PORT, HOST, () => {
  console.log(`[epd] EPDeeznuts draait op http://localhost:${PORT}`);
  if (process.env.DEMO_DATA !== '0') console.log('[epd] demo-accounts: wachtwoord "demo1234" (zie aanmeldscherm)');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await close().catch(() => {});
    process.exit(0);
  });
}
