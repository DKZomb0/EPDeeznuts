/**
 * Database access layer.
 *
 * Two drivers behind one async interface:
 *
 *   sqlite    node:sqlite, zero dependencies. The default, used for local
 *             development, demos and the test suite. Starts with nothing but a
 *             Node 22 binary.
 *   postgres  used whenever DATABASE_URL is set, which is how the app runs on
 *             Vercel: serverless functions have an ephemeral filesystem, so a
 *             SQLite file there would silently lose every write.
 *
 * The interface is async even for SQLite, because the Postgres driver cannot be
 * anything else and having one shape of call site is worth more than saving an
 * `await` in the sqlite path.
 *
 * Portability rules the rest of the codebase follows:
 *   - `?` placeholders everywhere; the Postgres driver rewrites them to $n.
 *   - no SQL-side date functions; timestamps are ISO strings produced in JS.
 *   - booleans stored as 0/1 integers (SMALLINT on Postgres).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const txStore = new AsyncLocalStorage();

let driver = null;
let readyPromise = null;

export function driverName() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

async function loadDriver() {
  if (driver) return driver;
  if (driverName() === 'postgres') {
    const mod = await import('./drivers/postgres.js');
    driver = await mod.create({ url: process.env.DATABASE_URL });
  } else {
    const mod = await import('./drivers/sqlite.js');
    driver = await mod.create({ path: process.env.EPD_DB });
  }
  return driver;
}

/** Current connection: the transaction's client if we are inside one. */
async function conn() {
  const scoped = txStore.getStore();
  if (scoped) return scoped;
  return loadDriver();
}

export async function all(sql, params = []) {
  const c = await conn();
  return c.all(sql, normalise(params));
}

export async function get(sql, params = []) {
  const c = await conn();
  const rows = await c.all(sql, normalise(params));
  return rows[0];
}

export async function run(sql, params = []) {
  const c = await conn();
  return c.run(sql, normalise(params));
}

export async function value(sql, params = []) {
  const row = await get(sql, params);
  if (!row) return undefined;
  return Object.values(row)[0];
}

/**
 * Run `fn` inside a transaction. Nested calls join the outer transaction rather
 * than opening a second one, so a route handler can call domain helpers that
 * each use `tx` without deadlocking.
 */
export async function tx(fn) {
  if (txStore.getStore()) return fn();
  const d = await loadDriver();
  return d.transaction(async (client) => txStore.run(client, fn));
}

export async function exec(sql) {
  const c = await conn();
  return c.exec(sql);
}

export async function close() {
  if (driver) {
    await driver.close();
    driver = null;
    readyPromise = null;
  }
}

/**
 * Ensure schema and seed data exist. Safe to call on every cold start: the
 * schema is CREATE ... IF NOT EXISTS throughout and the seed is a no-op once
 * organisations exist. Concurrent serverless instances are serialised by the
 * driver's bootstrap lock.
 */
export async function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d = await loadDriver();
      await d.withBootstrapLock(async () => {
        const { migrate } = await import('./migrate.js');
        await migrate();
        const { seed } = await import('./seed.js');
        await seed();
      });
      lastBootstrapError = null;
    })().catch((err) => {
      // Onthouden zodat /api/health kan zeggen wát er misging; zonder dat komt
      // een mislukte opstart bij de gebruiker aan als "er ging iets mis".
      lastBootstrapError = err;
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

let lastBootstrapError = null;

/**
 * Wat is hier aan de hand? Bedoeld om een mislukte uitrol in één oogopslag te
 * kunnen duiden: welke driver, waar staat de opslag, blijft ze bestaan, en wat
 * was de laatste opstartfout.
 */
export async function diagnostics() {
  const info = {
    driver: driverName(),
    databaseUrlSet: !!process.env.DATABASE_URL,
    serverless: !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
    demoData: process.env.DEMO_DATA !== '0',
    node: process.version,
    ephemeral: null,
    storageNote: null,
    location: null,
    ready: false,
    error: null,
  };

  try {
    const d = await loadDriver();
    info.ephemeral = d.ephemeral ?? false;
    info.storageNote = d.storageNote ?? null;
    info.location = d.location ?? null;
    await ready();
    info.ready = true;
  } catch (err) {
    info.error = err.message;
  }

  if (info.driver === 'sqlite' && info.serverless && !info.databaseUrlSet) {
    info.hint =
      'Deze omgeving is serverless maar er is geen DATABASE_URL ingesteld. Zonder Postgres is er geen opslag die een koude start overleeft.';
  }
  if (lastBootstrapError && !info.error) info.error = lastBootstrapError.message;

  return info;
}

/**
 * node:sqlite and pg both reject booleans/undefined/Date in bind parameters,
 * and application code produces all three constantly.
 */
function normalise(params) {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p;
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSetting(key, fallback = null) {
  const v = await value('SELECT value FROM settings WHERE key = ?', [key]);
  return v === undefined || v === null ? fallback : v;
}

export async function getSettingNumber(key, fallback) {
  const v = await getSetting(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function setSetting(key, val, userId = null) {
  await run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [key, String(val), new Date().toISOString(), userId],
  );
}

export async function allSettings() {
  return all('SELECT key, value, updated_at FROM settings ORDER BY key');
}
