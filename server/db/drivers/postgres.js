/**
 * Postgres driver - used whenever DATABASE_URL is set, which is how the app
 * runs on Vercel (Vercel Postgres, Neon, Supabase and plain RDS all work).
 *
 * `pg` is an optional dependency: it is imported dynamically so a local
 * SQLite-only checkout never needs it installed.
 *
 * Two translations happen here and nowhere else in the codebase:
 *   - `?` placeholders become $1..$n
 *   - the SQLite-flavoured schema is replaced by schema.postgres.sql
 */
export const dialect = 'postgres';

export async function create({ url } = {}) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error(
      'DATABASE_URL is set but the "pg" package is not installed. Run `npm install pg` (it is an optional dependency).',
    );
  }
  const { Pool } = pg.default ?? pg;

  const pool = new Pool({
    connectionString: url,
    // Managed Postgres offerings terminate TLS with their own chain; Vercel's
    // integration sets sslmode in the URL, so only force it when it is absent.
    ssl: /sslmode=/.test(url ?? '') ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });

  const wrap = (executor) => ({
    dialect: 'postgres',
    async all(sql, params) {
      const res = await executor.query(toPositional(sql), params);
      return res.rows;
    },
    async run(sql, params) {
      const res = await executor.query(toPositional(sql), params);
      return { changes: res.rowCount ?? 0, lastInsertRowid: null };
    },
    async exec(sql) {
      await executor.query(sql);
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the original error is the interesting one */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    /**
     * Serverless cold starts race each other. An advisory lock makes migrate +
     * seed run exactly once even when ten instances boot at the same moment.
     */
    async withBootstrapLock(fn) {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_LOCK_KEY]);
        return await fn();
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [BOOTSTRAP_LOCK_KEY]);
        } finally {
          client.release();
        }
      }
    },
    async close() {
      await pool.end();
    },
  };
}

const BOOTSTRAP_LOCK_KEY = 828_141_207;

/**
 * Rewrite `?` placeholders to $1..$n, leaving anything inside string literals
 * alone. The codebase never puts a literal `?` in SQL text, but quoted strings
 * do appear (status defaults, for instance), so the scan tracks quoting.
 */
export function toPositional(sql) {
  let out = '';
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === '?' && !inSingle && !inDouble) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}
