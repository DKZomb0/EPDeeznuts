/**
 * The audit trail.
 *
 * An organisation always sees its own actions. Verifiers, the federation and
 * the regulator see everything - that is the point of the oversight roles.
 */
import { Router } from '../router.js';
import { ok, notFound } from '../respond.js';
import { search, count, actions, forEntity } from '../../lib/audit.js';
import { isOversight } from '../../domain/permissions.js';

const router = new Router();

router.get('/audit', async ({ res, user, query }) => {
  const filter = {
    orgId: isOversight(user) ? (query.orgId ?? null) : user.orgId,
    action: query.action ?? null,
    entityType: query.entityType ?? null,
    q: query.q ?? null,
    limit: Math.min(Number(query.limit ?? 100), 500),
    offset: Number(query.offset ?? 0),
  };

  ok(res, {
    entries: await search(filter),
    total: await count(filter),
    actions: await actions(),
    scope: isOversight(user) ? 'ALL' : 'OWN',
  });
});

router.get('/audit/:type/:id', async ({ res, params }) => {
  const entries = await forEntity(params.type.toUpperCase(), params.id, 200);
  if (!entries) throw notFound('Geen audittrail gevonden.');
  ok(res, { entries });
});

export default router;
