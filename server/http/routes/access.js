/**
 * Access requests between organisations.
 *
 * A cement producer's declarations are commercially sensitive: it does not want
 * a plant that buys nothing from it reading its numbers. So a producer requests
 * access and the supplier decides. Both sides of the exchange are auditable,
 * because a producer that cannot get access has to be able to show it asked.
 */
import { Router } from '../router.js';
import { all, get, run } from '../../db/index.js';
import { ok, created, str, notFound, badRequest, conflict } from '../respond.js';
import { id } from '../../lib/ids.js';
import { record, notify } from '../../lib/audit.js';
import { requireCap, ownsOrThrow } from '../../domain/permissions.js';
import { ACCESS_STATUS } from '../../domain/constants.js';
import { nowIso } from '../../domain/versioning.js';

const router = new Router();

/** Both directions in one call: what we asked for, and what was asked of us. */
router.get('/access', async ({ res, user }) => {
  const [outgoing, incoming] = await Promise.all([
    all(
      `SELECT ar.*, o.name AS owner_name, o.type AS owner_type, m.name AS material_name
         FROM access_requests ar
         JOIN organisations o ON o.id = ar.owner_org_id
         LEFT JOIN materials m ON m.id = ar.material_id
        WHERE ar.requester_org_id = ?
        ORDER BY ar.created_at DESC`,
      [user.orgId],
    ),
    all(
      `SELECT ar.*, o.name AS requester_name, o.type AS requester_type, o.city AS requester_city, m.name AS material_name
         FROM access_requests ar
         JOIN organisations o ON o.id = ar.requester_org_id
         LEFT JOIN materials m ON m.id = ar.material_id
        WHERE ar.owner_org_id = ?
        ORDER BY CASE ar.status WHEN 'PENDING' THEN 0 ELSE 1 END, ar.created_at DESC`,
      [user.orgId],
    ),
  ]);
  ok(res, { outgoing, incoming });
});

router.post('/access', async ({ res, user, body }) => {
  requireCap(user, 'access:request', 'Alleen een afnemer kan toegang aanvragen.');

  const ownerOrgId = str(body.ownerOrgId, 'leverancier', { required: true });
  const materialId = str(body.materialId, 'grondstof');
  if (ownerOrgId === user.orgId) throw badRequest('U hebt al toegang tot uw eigen gegevens.');

  const owner = await get('SELECT * FROM organisations WHERE id = ?', [ownerOrgId]);
  if (!owner) throw notFound('Leverancier niet gevonden.');

  const scopeClause = materialId ? 'AND material_id = ?' : 'AND material_id IS NULL';
  const existing = await get(
    `SELECT * FROM access_requests
      WHERE requester_org_id = ? AND owner_org_id = ?
        ${scopeClause}
        AND status IN ('PENDING','GRANTED')`,
    materialId ? [user.orgId, ownerOrgId, materialId] : [user.orgId, ownerOrgId],
  );
  if (existing) {
    throw conflict(existing.status === 'GRANTED' ? 'U hebt hier al toegang toe.' : 'Er loopt al een aanvraag voor deze leverancier.');
  }

  const requestId = id('acc');
  await run(
    `INSERT INTO access_requests (id, requester_org_id, owner_org_id, material_id, status, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    [requestId, user.orgId, ownerOrgId, materialId, str(body.reason, 'motivering', { required: true, max: 1000 }), user.id, nowIso()],
  );

  await record(user, 'ACCESS_REQUESTED', { type: 'ACCESS_REQUEST', id: requestId }, `Toegang aangevraagd tot de gegevens van ${owner.name}.`, {
    materialId,
    reason: body.reason,
  });
  await notify(ownerOrgId, 'ACCESS_REQUEST', `${user.orgName} vraagt toegang`, str(body.reason, 'motivering'), '#/access');

  created(res, { request: await get('SELECT * FROM access_requests WHERE id = ?', [requestId]) });
});

router.post('/access/:id/decide', async ({ res, user, params, body }) => {
  requireCap(user, 'access:decide', 'Alleen de eigenaar van de gegevens kan hierover beslissen.');

  const request = await get('SELECT * FROM access_requests WHERE id = ?', [params.id]);
  if (!request) throw notFound('Aanvraag niet gevonden.');
  ownsOrThrow(user, request.owner_org_id, 'Deze aanvraag is gericht aan een andere organisatie.');

  const grant = body.decision === 'GRANT' || body.decision === true;
  const status = grant ? ACCESS_STATUS.GRANTED : ACCESS_STATUS.DENIED;

  await run('UPDATE access_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', [
    status,
    user.id,
    nowIso(),
    str(body.note, 'nota'),
    params.id,
  ]);

  const requester = await get('SELECT name FROM organisations WHERE id = ?', [request.requester_org_id]);
  await record(
    user,
    grant ? 'ACCESS_GRANTED' : 'ACCESS_DENIED',
    { type: 'ACCESS_REQUEST', id: params.id },
    `Toegang voor ${requester?.name} ${grant ? 'toegekend' : 'geweigerd'}.`,
    { note: body.note },
  );
  await notify(
    request.requester_org_id,
    grant ? 'ACCESS_GRANTED' : 'ACCESS_DENIED',
    grant ? `${user.orgName} heeft toegang verleend` : `${user.orgName} heeft toegang geweigerd`,
    str(body.note, 'nota'),
    '#/materials',
  );

  ok(res, { request: await get('SELECT * FROM access_requests WHERE id = ?', [params.id]) });
});

/** Revoking is a first-class action: a supplier can end a commercial relation. */
router.post('/access/:id/revoke', async ({ res, user, params, body }) => {
  requireCap(user, 'access:decide');
  const request = await get('SELECT * FROM access_requests WHERE id = ?', [params.id]);
  if (!request) throw notFound('Aanvraag niet gevonden.');
  ownsOrThrow(user, request.owner_org_id);

  await run('UPDATE access_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', [
    ACCESS_STATUS.REVOKED,
    user.id,
    nowIso(),
    str(body.note, 'nota'),
    params.id,
  ]);

  await record(user, 'ACCESS_REVOKED', { type: 'ACCESS_REQUEST', id: params.id }, 'Toegang ingetrokken.', { note: body.note });
  await notify(request.requester_org_id, 'ACCESS_REVOKED', `${user.orgName} heeft uw toegang ingetrokken`, str(body.note, 'nota'), '#/materials');

  ok(res, { request: await get('SELECT * FROM access_requests WHERE id = ?', [params.id]) });
});

export default router;
