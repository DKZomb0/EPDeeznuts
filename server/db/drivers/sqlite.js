/**
 * node:sqlite driver - the zero-dependency default.
 *
 * Synchronous underneath, wrapped in the async interface the Postgres driver
 * forces on everyone. `:memory:` is used by the test suite.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PATH = join(here, '..', '..', '..', 'data', 'epdeeznuts.db');

export const dialect = 'sqlite';

export async function create({ path } = {}) {
  const file = path || DEFAULT_PATH;
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

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
