/**
 * Password hashing and session handling.
 *
 * scrypt from node:crypto - no dependency, and it is the algorithm you can
 * defend in an audit. In production this module is expected to be replaced by
 * an OIDC integration (Entra ID was the plan). Nothing else in the codebase
 * knows how a user proved who they are: the rest only ever sees the record
 * returned by `userForToken`.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, run } from '../db/index.js';
import { token as newToken } from './ids.js';

const KEYLEN = 64;
const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function login(email, password) {
  const user = await get(
    `SELECT u.*, o.name AS org_name, o.type AS org_type
       FROM users u JOIN organisations o ON o.id = u.org_id
      WHERE lower(u.email) = lower(?) AND u.active = 1`,
    [email],
  );
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString();
  await run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
    token,
    user.id,
    now.toISOString(),
    expires,
  ]);
  return { token, expires, user: publicUser(user) };
}

export async function logout(token) {
  if (!token) return;
  await run('DELETE FROM sessions WHERE token = ?', [token]);
}

export async function userForToken(token) {
  if (!token) return null;
  const row = await get(
    `SELECT u.*, o.name AS org_name, o.type AS org_type, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organisations o ON o.id = u.org_id
      WHERE s.token = ? AND u.active = 1`,
    [token],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return publicUser(row);
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    orgId: row.org_id,
    orgName: row.org_name,
    orgType: row.org_type,
  };
}

/** Feeds the demo login screen so a pitch audience can switch personas fast. */
export async function demoAccounts() {
  return all(
    `SELECT u.email, u.name, u.role, o.name AS org_name, o.type AS org_type
       FROM users u JOIN organisations o ON o.id = u.org_id
      WHERE u.active = 1
      -- Narrative order, not alphabetical: whoever opens the demo should land
      -- on the producer first, because that is where the story starts.
      ORDER BY CASE o.type
        WHEN 'PRODUCER' THEN 1 WHEN 'SUPPLIER' THEN 2 WHEN 'VERIFIER' THEN 3
        WHEN 'CONTRACTOR' THEN 4 WHEN 'FEDERATION' THEN 5 WHEN 'REGULATOR' THEN 6 ELSE 7 END,
        o.name, u.name`,
  );
}

export async function purgeExpiredSessions() {
  await run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
}
