/**
 * Append-only audit trail.
 *
 * The regulator's condition for accepting the platform was that every number
 * can be traced back to a person and a moment. Nothing in the application ever
 * updates or deletes a row here.
 */
import { all, get, run } from '../db/index.js';

/**
 * @param {object|null} actor  the authenticated user, or null for system actions
 * @param {string} action      verb in SCREAMING_SNAKE, e.g. MATERIAL_VERSION_CREATED
 * @param {object} entity      { type, id }
 * @param {string} summary     one human sentence, shown as-is in the UI
 * @param {object} [detail]    structured before/after payload
 */
export async function record(actor, action, entity, summary, detail = null) {
  await run(
    `INSERT INTO audit_log (ts, actor_user_id, actor_org_id, actor_label, action, entity_type, entity_id, summary, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      actor?.id ?? null,
      actor?.orgId ?? null,
      actor ? `${actor.name} (${actor.orgName})` : 'Systeem',
      action,
      entity?.type ?? null,
      entity?.id ?? null,
      summary,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}

export async function forEntity(type, entityId, limit = 200) {
  const rows = await all(
    'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?',
    [type, entityId, limit],
  );
  return rows.map(hydrate);
}

export async function search({ orgId = null, action = null, entityType = null, q = null, limit = 200, offset = 0 } = {}) {
  const { where, params } = buildFilter({ orgId, action, entityType, q });
  const rows = await all(
    `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(hydrate);
}

export async function count(filter = {}) {
  const { where, params } = buildFilter(filter);
  const row = await get(`SELECT COUNT(*) AS n FROM audit_log ${where}`, params);
  return Number(row?.n ?? 0);
}

function buildFilter({ orgId = null, action = null, entityType = null, q = null } = {}) {
  const clauses = [];
  const params = [];
  if (orgId) {
    clauses.push('actor_org_id = ?');
    params.push(orgId);
  }
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  if (entityType) {
    clauses.push('entity_type = ?');
    params.push(entityType);
  }
  if (q) {
    clauses.push('(lower(summary) LIKE lower(?) OR lower(actor_label) LIKE lower(?) OR entity_id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function hydrate(row) {
  return { ...row, detail: row.detail_json ? JSON.parse(row.detail_json) : null };
}

/** Distinct action codes, for the audit filter dropdown. */
export async function actions() {
  const rows = await all('SELECT DISTINCT action FROM audit_log ORDER BY action');
  return rows.map((r) => r.action);
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/**
 * In-app notification. The real deployment will fan these out to e-mail and to
 * the ERP integrations, but the record stays here because "who was told what,
 * when" is part of the same evidential chain as the audit log.
 */
export async function notify(orgId, kind, title, body = null, link = null) {
  const { id } = await import('./ids.js');
  await run(
    'INSERT INTO notifications (id, org_id, kind, title, body, link, seen, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [id('ntf'), orgId, kind, title, body, link, new Date().toISOString()],
  );
}

export async function notificationsFor(orgId, limit = 30) {
  return all('SELECT * FROM notifications WHERE org_id = ? ORDER BY created_at DESC LIMIT ?', [orgId, limit]);
}

export async function markNotificationsSeen(orgId) {
  await run('UPDATE notifications SET seen = 1 WHERE org_id = ?', [orgId]);
}
