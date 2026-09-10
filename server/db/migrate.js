/**
 * Schema migration.
 *
 * There is one schema file. For Postgres it is translated on the fly rather
 * than duplicated, because two hand-maintained DDL files drift apart within a
 * week and the drift only shows up in production.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverName, exec } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function schemaSql(dialect = driverName()) {
  const raw = readFileSync(join(here, 'schema.sql'), 'utf8');
  return dialect === 'postgres' ? toPostgres(raw) : raw;
}

export async function migrate() {
  const sql = schemaSql();
  // Postgres cannot run a multi-statement string containing CREATE INDEX
  // alongside CREATE TABLE in one simple query in every driver version, and
  // SQLite does not mind either way, so statements are applied one by one.
  for (const statement of splitStatements(sql)) {
    await exec(statement);
  }
}

/**
 * SQLite DDL -> Postgres DDL. The schema deliberately sticks to a portable
 * subset, so this stays a handful of substitutions.
 */
export function toPostgres(sql) {
  return sql
    .replace(/^\s*PRAGMA[^;]*;\s*$/gim, '')
    .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bREAL\b/gi, 'DOUBLE PRECISION');
}

/** Split on semicolons that are not inside a string literal or a comment. */
export function splitStatements(sql) {
  const out = [];
  let current = '';
  let inSingle = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!inSingle && ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") inSingle = !inSingle;

    if (ch === ';' && !inSingle) {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) out.push(tail);
  // Drop fragments that are nothing but comment lines - the file has banner
  // blocks between statements.
  return out.filter((statement) =>
    statement
      .split('\n')
      .some((line) => line.trim() && !line.trim().startsWith('--')),
  );
}
