/**
 * Drop the local database and rebuild it from schema + seed.
 * SQLite only - refuses to touch a Postgres deployment.
 */
import { rmSync } from 'node:fs';
import { DEFAULT_PATH } from './drivers/sqlite.js';
import { driverName, ready, close } from './index.js';

if (driverName() === 'postgres') {
  console.error('[epd] reset werkt alleen op de lokale SQLite-databank, niet op een Postgres-omgeving.');
  process.exit(1);
}

const path = process.env.EPD_DB || DEFAULT_PATH;
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  rmSync(`${path}${suffix}`, { force: true });
}
console.log(`[epd] verwijderd: ${path}`);

await ready();
await close();
console.log('[epd] databank opnieuw opgebouwd met masterdata en demogegevens.');
