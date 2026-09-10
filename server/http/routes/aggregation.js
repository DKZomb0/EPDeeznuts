/**
 * Sector averages and the TOTEM export.
 */
import { Router } from '../router.js';
import { all, get, run } from '../../db/index.js';
import { ok, created, str, notFound } from '../respond.js';
import { id } from '../../lib/ids.js';
import { record } from '../../lib/audit.js';
import { requireCap, can } from '../../domain/permissions.js';
import { buildAggregation, toTotemPayload } from '../../domain/aggregate.js';
import { nowIso } from '../../domain/versioning.js';

const router = new Router();

/** Live preview: what would the sector average look like right now? */
router.get('/aggregation/preview', async ({ res, user, query }) => {
  if (!can(user, 'aggregation:write') && !can(user, 'aggregation:read')) {
    requireCap(user, 'aggregation:write', 'Sectorgemiddelden worden opgesteld door de federatie.');
  }
  ok(res, {
    aggregation: await buildAggregation({
      strengthClass: str(query.strengthClass, 'sterkteklasse'),
      exposureClass: str(query.exposureClass, 'omgevingsklasse'),
      method: query.method === 'SIMPLE' ? 'SIMPLE' : 'VOLUME_WEIGHTED',
      since: str(query.since, 'vanaf'),
    }),
  });
});

router.get('/aggregations', async ({ res }) => {
  const rows = await all('SELECT id, label, strength_class, exposure_class, method, sample_size, published, created_at FROM aggregations ORDER BY created_at DESC');
  ok(res, { aggregations: rows });
});

router.get('/aggregations/:id', async ({ res, params }) => {
  const row = await get('SELECT * FROM aggregations WHERE id = ?', [params.id]);
  if (!row) throw notFound('Sectorgemiddelde niet gevonden.');
  ok(res, { aggregation: { ...row, payload: JSON.parse(row.payload_json) } });
});

/** Freeze the current average so it can be cited and traced back. */
router.post('/aggregations', async ({ res, user, body }) => {
  requireCap(user, 'aggregation:write', 'Sectorgemiddelden worden opgesteld door de federatie.');

  const aggregation = await buildAggregation({
    strengthClass: str(body.strengthClass, 'sterkteklasse'),
    exposureClass: str(body.exposureClass, 'omgevingsklasse'),
    method: body.method === 'SIMPLE' ? 'SIMPLE' : 'VOLUME_WEIGHTED',
    since: str(body.since, 'vanaf'),
  });

  const aggregationId = id('agg');
  const label = str(body.label, 'benaming', { required: true, max: 200 });

  await run(
    `INSERT INTO aggregations (id, org_id, label, strength_class, exposure_class, method, sample_size, payload_json, published, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      aggregationId,
      user.orgId,
      label,
      aggregation.filter.strengthClass,
      aggregation.filter.exposureClass,
      aggregation.method,
      aggregation.sampleSize,
      JSON.stringify(aggregation),
      body.publish ? 1 : 0,
      user.id,
      nowIso(),
    ],
  );

  await record(
    user,
    'AGGREGATION_CREATED',
    { type: 'AGGREGATION', id: aggregationId },
    `Sectorgemiddelde "${label}" opgesteld uit ${aggregation.sampleSize} declaratie(s).`,
    { lead: aggregation.lead },
  );

  created(res, { aggregation: { id: aggregationId, label, ...aggregation } });
});

/**
 * TOTEM-facing export. The exchange format still has to be agreed with OVAM,
 * so the payload is self-describing rather than a guess at their schema.
 */
router.get('/aggregations/:id/totem', async ({ res, params }) => {
  const row = await get('SELECT * FROM aggregations WHERE id = ?', [params.id]);
  if (!row) throw notFound('Sectorgemiddelde niet gevonden.');
  ok(res, { payload: toTotemPayload(JSON.parse(row.payload_json), row.label) });
});

export default router;
