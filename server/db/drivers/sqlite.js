/**
 * node:sqlite driver - the zero-dependency default.
 *
 * Synchronous underneath, wrapped in the async interface the Postgres driver
 * forces on everyone. `:memory:` is used by the test suite.
 *
 * Serverless is the awkward case. On Vercel the bundle lives in a read-only
 * /var/task, so the default path cannot be created at all; only /tmp is
 * writable, and it is wiped between cold starts and not shared between
 * instances. Rather than failing to boot, the driver falls back to /tmp and
 * marks the storage ephemeral, so the interface can say out loud that nothing
 * is being kept. A real deployment sets DATABASE_URL and never lands here.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PATH = join(here, '..', '..', '..', 'data', 'epdeeznuts.db');
const FALLBACK_PATH = join(tmpdir(), 'materia', 'epdeeznuts.db');

export const dialect = 'sqlite';

/**
 * Pick a path we can actually write to.
 * Returns { file, ephemeral, note } - `note` is shown to the operator, not swallowed.
 */
export function resolvePath(requested) {
  const file = requested || DEFAULT_PATH;
  if (file === ':memory:') return { file, ephemeral: true, note: null };

  try {
    mkdirSync(dirname(file), { recursive: true });
    accessSync(dirname(file), constants.W_OK);
    return { file, ephemeral: false, note: null };
  } catch (err) {
    if (requested) {
      // An explicitly configured path that does not work is a real error; do
      // not quietly write somewhere else than the operator asked for.
      throw new Error(`De opgegeven databankmap is niet beschrijfbaar: ${dirname(file)} (${err.code ?? err.message})`);
    }
    mkdirSync(dirname(FALLBACK_PATH), { recursive: true });
    return {
      file: FALLBACK_PATH,
      ephemeral: true,
      note:
        'Geen DATABASE_URL ingesteld en de projectmap is niet beschrijfbaar (serverless). ' +
        'De databank staat in /tmp: gegevens verdwijnen bij elke koude start en worden niet gedeeld tussen instanties. ' +
        'Stel DATABASE_URL in op een Postgres-databank voor een bruikbare opstelling.',
    };
  }
}

export async function create({ path } = {}) {
  const { file, ephemeral, note } = resolvePath(path);
  if (note) console.warn(`[epd] ${note}`);

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  // WAL needs to create side files next to the database; on a fallback path
  // that is fine, but it buys nothing for a store that is thrown away anyway.
  if (file !== ':memory:' && !ephemeral) db.exec('PRAGMA journal_mode = WAL;');

  const client = {
    dialect: 'sqlite',
    async all(sql, params) {
      return db
        .prepare(sql)
        .all(...params)
        .map((r) => ({ ...r }));
    },
    async run(sql, params) {
      const res = db.prepare(sql).run(...params);
      return { changes: Number(res.changes ?? 0), lastInsertRowid: res.lastInsertRowid };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };

  return {
    ...client,
    ephemeral,
    storageNote: note,
    location: file,
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const out = await fn(client);
        db.exec('COMMIT');
        return out;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* the original error is the interesting one */
        }
        throw err;
      }
    },
    // A single-process SQLite file needs no cross-instance coordination.
    async withBootstrapLock(fn) {
      return fn();
    },
    async close() {
      db.close();
    },
  };
}
