/**
 * Role-specific landing page data.
 *
 * Each party opens this platform for a different reason, so the dashboard is
 * assembled per organisation type rather than being one screen with everything
 * greyed out.
 */
import { Router } from '../router.js';
import { all, get, allSettings } from '../../db/index.js';
import { ok } from '../respond.js';
import { notificationsFor } from '../../lib/audit.js';
import { ORG_TYPES, LEAD_INDICATOR } from '../../domain/constants.js';
import { buildAggregation } from '../../domain/aggregate.js';
import { nowIso } from '../../domain/versioning.js';

const router = new Router();

router.get('/dashboard', async ({ res, user }) => {
  const base = {
    orgType: user.orgType,
    notifications: await notificationsFor(user.orgId, 10),
    generatedAt: nowIso(),
  };

  switch (user.orgType) {
    case ORG_TYPES.SUPPLIER:
      return ok(res, { ...base, ...(await supplierDashboard(user)) });
    case ORG_TYPES.PRODUCER:
      return ok(res, { ...base, ...(await producerDashboard(user)) });
    case ORG_TYPES.CONTRACTOR:
      return ok(res, { ...base, ...(await contractorDashboard(user)) });
    case ORG_TYPES.VERIFIER:
      return ok(res, { ...base, ...(await verifierDashboard(user)) });
    case ORG_TYPES.FEDERATION:
    case ORG_TYPES.REGULATOR:
      return ok(res, { ...base, ...(await sectorDashboard(user)) });
    default:
      return ok(res, base);
  }
});

/**
 * Tellers voor de zijbalk. Apart van het dashboard omdat de navigatie
 * getekend wordt voordat een pagina geladen is.
 */
router.get('/navcounts', async ({ res, user }) => {
  const counts = {};

  switch (user.orgType) {
    case ORG_TYPES.SUPPLIER:
      counts.materials = await scalar('SELECT COUNT(*) AS n FROM materials WHERE org_id = ? AND archived = 0', [user.orgId]);
      counts.access = await scalar("SELECT COUNT(*) AS n FROM access_requests WHERE owner_org_id = ? AND status = 'PENDING'", [user.orgId]);
      break;
    case ORG_TYPES.PRODUCER:
      counts.recipes = await scalar('SELECT COUNT(*) AS n FROM recipes WHERE org_id = ? AND archived = 0', [user.orgId]);
      counts.declarations = await scalar('SELECT COUNT(*) AS n FROM declarations WHERE org_id = ?', [user.orgId]);
      counts.access = await scalar("SELECT COUNT(*) AS n FROM access_requests WHERE requester_org_id = ? AND status = 'PENDING'", [user.orgId]);
      counts.projects = await scalar('SELECT COUNT(DISTINCT project_id) AS n FROM deliveries WHERE producer_org_id = ?', [user.orgId]);
      break;
    case ORG_TYPES.CONTRACTOR:
      counts.projects = await scalar('SELECT COUNT(*) AS n FROM projects WHERE org_id = ? AND archived = 0', [user.orgId]);
      counts.deliveries = await scalar('SELECT COUNT(*) AS n FROM deliveries WHERE contractor_org_id = ?', [user.orgId]);
      break;
    case ORG_TYPES.VERIFIER:
      counts.verification = await scalar("SELECT COUNT(*) AS n FROM declarations WHERE status IN ('SUBMITTED','UNDER_VERIFICATION')");
      counts.recipes = await scalar('SELECT COUNT(*) AS n FROM recipes WHERE archived = 0');
      counts.projects = await scalar('SELECT COUNT(*) AS n FROM projects WHERE archived = 0');
      break;
    default:
      counts.declarations = await scalar("SELECT COUNT(*) AS n FROM declarations WHERE status = 'PUBLISHED'");
      counts.recipes = await scalar('SELECT COUNT(*) AS n FROM recipes WHERE archived = 0');
      counts.materials = await scalar('SELECT COUNT(*) AS n FROM materials WHERE archived = 0');
      break;
  }

  counts.notifications = await scalar('SELECT COUNT(*) AS n FROM notifications WHERE org_id = ? AND seen = 0', [user.orgId]);
  ok(res, { counts });
});

/* ------------------------------------------------------------------ */

async function supplierDashboard(user) {
  const soon = new Date(Date.now() + 180 * 86400_000).toISOString();

  return {
    stats: [
      { key: 'materials', label: 'Grondstoffen', value: await scalar('SELECT COUNT(*) AS n FROM materials WHERE org_id = ? AND archived = 0', [user.orgId]) },
      { key: 'evidence', label: 'Bewijsstukken', value: await scalar('SELECT COUNT(*) AS n FROM evidence WHERE org_id = ?', [user.orgId]) },
      {
        key: 'pending',
        label: 'Openstaande toegangsaanvragen',
        value: await scalar("SELECT COUNT(*) AS n FROM access_requests WHERE owner_org_id = ? AND status = 'PENDING'", [user.orgId]),
        tone: 'warn',
      },
      {
        key: 'customers',
        label: 'Afnemers met toegang',
        value: await scalar("SELECT COUNT(DISTINCT requester_org_id) AS n FROM access_requests WHERE owner_org_id = ? AND status = 'GRANTED'", [user.orgId]),
      },
    ],
    pendingAccess: await all(
      `SELECT ar.*, o.name AS requester_name, o.city AS requester_city
         FROM access_requests ar JOIN organisations o ON o.id = ar.requester_org_id
        WHERE ar.owner_org_id = ? AND ar.status = 'PENDING' ORDER BY ar.created_at DESC`,
      [user.orgId],
    ),
    // A supplier whose declaration lapses silently invalidates the dossiers of
    // every producer downstream, so expiry gets its own panel.
    expiring: await all(
      `SELECT e.*, (SELECT COUNT(*) FROM material_versions mv WHERE mv.evidence_id = e.id) AS use_count
         FROM evidence e
        WHERE e.org_id = ? AND e.valid_until IS NOT NULL AND e.valid_until <= ?
        ORDER BY e.valid_until`,
      [user.orgId, soon],
    ),
    recentVersions: await all(
      `SELECT mv.*, m.name AS material_name, m.code AS material_code
         FROM material_versions mv JOIN materials m ON m.id = mv.material_id
        WHERE m.org_id = ? ORDER BY mv.created_at DESC LIMIT 8`,
      [user.orgId],
    ),
  };
}

async function producerDashboard(user) {
  const declarations = await all(
    `SELECT d.status, COUNT(*) AS n FROM declarations d WHERE d.org_id = ? GROUP BY d.status`,
    [user.orgId],
  );

  const recipes = await all(
    `SELECT r.id, r.code, r.name, r.strength_class,
            (SELECT COUNT(*) FROM recipe_versions rv WHERE rv.recipe_id = r.id) AS versions
       FROM recipes r WHERE r.org_id = ? AND r.archived = 0 ORDER BY r.code`,
    [user.orgId],
  );

  return {
    stats: [
      { key: 'recipes', label: 'Recepturen', value: recipes.length },
      {
        key: 'published',
        label: 'Gepubliceerde declaraties',
        value: Number(declarations.find((d) => d.status === 'PUBLISHED')?.n ?? 0),
        tone: 'ok',
      },
      {
        key: 'pending',
        label: 'In verificatie',
        value: declarations.filter((d) => ['SUBMITTED', 'UNDER_VERIFICATION'].includes(d.status)).reduce((s, d) => s + Number(d.n), 0),
        tone: 'warn',
      },
      {
        key: 'bypass',
        label: 'Automatisch aanvaarde wijzigingen',
        value: Number(declarations.find((d) => d.status === 'AUTO_ACCEPTED')?.n ?? 0),
      },
    ],
    declarationsByStatus: declarations,
    recipes,
    // What is blocking us right now: dossiers that cannot be published, and
    // access we asked for but did not get.
    blocked: await all(
      `SELECT d.id, d.verdict, d.status, r.code AS recipe_code, rv.version_no
         FROM declarations d
         JOIN recipe_versions rv ON rv.id = d.recipe_version_id
         JOIN recipes r ON r.id = rv.recipe_id
        WHERE d.org_id = ? AND d.verdict <> 'VALID'
        ORDER BY d.created_at DESC LIMIT 10`,
      [user.orgId],
    ),
    pendingAccess: await all(
      `SELECT ar.*, o.name AS owner_name FROM access_requests ar
         JOIN organisations o ON o.id = ar.owner_org_id
        WHERE ar.requester_org_id = ? AND ar.status = 'PENDING' ORDER BY ar.created_at DESC`,
      [user.orgId],
    ),
    recentDeliveries: await all(
      `SELECT d.id, d.delivery_note, d.volume_m3, d.delivered_at, r.code AS recipe_code, p.name AS project_name
         FROM deliveries d
         JOIN recipe_versions rv ON rv.id = d.recipe_version_id
         JOIN recipes r ON r.id = rv.recipe_id
         JOIN projects p ON p.id = d.project_id
        WHERE d.producer_org_id = ? ORDER BY d.delivered_at DESC LIMIT 8`,
      [user.orgId],
    ),
  };
}

async function contractorDashboard(user) {
  const deliveries = await all(
    `SELECT d.id, d.delivery_note, d.volume_m3, d.delivered_at, d.distance_km,
            r.code AS recipe_code, r.strength_class, p.name AS project_name, p.id AS project_id,
            o.name AS producer_name,
            (SELECT decision FROM gate_checks g WHERE g.subject_type = 'DELIVERY' AND g.subject_id = d.id ORDER BY g.created_at DESC LIMIT 1) AS last_decision
       FROM deliveries d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN projects p ON p.id = d.project_id
       JOIN organisations o ON o.id = d.producer_org_id
      WHERE d.contractor_org_id = ? ORDER BY d.delivered_at DESC LIMIT 20`,
    [user.orgId],
  );

  const volume = deliveries.reduce((s, d) => s + Number(d.volume_m3 ?? 0), 0);

  return {
    stats: [
      { key: 'projects', label: 'Projecten', value: await scalar('SELECT COUNT(*) AS n FROM projects WHERE org_id = ? AND archived = 0', [user.orgId]) },
      { key: 'deliveries', label: 'Leveringen', value: deliveries.length },
      { key: 'volume', label: 'Volume (m³)', value: Math.round(volume) },
      {
        key: 'attention',
        label: 'Leveringen met opmerking',
        value: deliveries.filter((d) => d.last_decision && d.last_decision !== 'GO').length,
        tone: 'warn',
      },
    ],
    deliveries,
    projects: await all(
      `SELECT p.*, (SELECT COUNT(*) FROM deliveries d WHERE d.project_id = p.id) AS delivery_count
         FROM projects p WHERE p.org_id = ? AND p.archived = 0 ORDER BY p.created_at DESC`,
      [user.orgId],
    ),
  };
}

async function verifierDashboard(user) {
  const queue = await all(
    `SELECT d.id, d.status, d.verdict, d.scope, d.submitted_at, r.code AS recipe_code, r.name AS recipe_name,
            r.strength_class, rv.version_no, o.name AS producer_name
       FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN organisations o ON o.id = d.org_id
      WHERE d.status IN ('SUBMITTED', 'UNDER_VERIFICATION')
      ORDER BY d.submitted_at`,
    [],
  );

  return {
    stats: [
      { key: 'queue', label: 'Wachtend op verificatie', value: queue.filter((q) => q.status === 'SUBMITTED').length, tone: 'warn' },
      { key: 'busy', label: 'In behandeling', value: queue.filter((q) => q.status === 'UNDER_VERIFICATION').length },
      {
        key: 'verified',
        label: 'Goedgekeurd door ons',
        value: await scalar("SELECT COUNT(*) AS n FROM declarations WHERE verifier_org_id = ? AND status IN ('VERIFIED','PUBLISHED')", [user.orgId]),
        tone: 'ok',
      },
      {
        key: 'bypassed',
        label: 'Automatisch aanvaard (geen controle nodig)',
        value: await scalar("SELECT COUNT(*) AS n FROM declarations WHERE status = 'AUTO_ACCEPTED'"),
      },
    ],
    queue,
    // The overrides are the verifier's real audit list: every place a producer
    // departed from a sector default or waved a delivery through.
    overrides: await all(
      `SELECT rp.code, rp.value, rp.unit, rp.justification, r.code AS recipe_code, rv.version_no, o.name AS producer_name
         FROM recipe_parameters rp
         JOIN recipe_versions rv ON rv.id = rp.recipe_version_id
         JOIN recipes r ON r.id = rv.recipe_id
         JOIN organisations o ON o.id = r.org_id
        WHERE rp.overridden = 1
        ORDER BY rv.created_at DESC LIMIT 20`,
    ),
    manualOverrides: await all(
      `SELECT g.*, d.delivery_note, p.name AS project_name
         FROM gate_checks g
         LEFT JOIN deliveries d ON d.id = g.subject_id
         LEFT JOIN projects p ON p.id = d.project_id
        WHERE g.decision IN ('MANUAL_OVERRIDE', 'NO_GO')
        ORDER BY g.created_at DESC LIMIT 20`,
    ),
    recent: await all(
      `SELECT d.id, d.status, d.verified_at, d.certificate_no, r.code AS recipe_code, o.name AS producer_name
         FROM declarations d
         JOIN recipe_versions rv ON rv.id = d.recipe_version_id
         JOIN recipes r ON r.id = rv.recipe_id
         JOIN organisations o ON o.id = d.org_id
        WHERE d.verifier_org_id = ? AND d.verified_at IS NOT NULL
        ORDER BY d.verified_at DESC LIMIT 10`,
      [user.orgId],
    ),
  };
}

async function sectorDashboard() {
  const classes = await all(
    `SELECT r.strength_class AS code, COUNT(*) AS n
       FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
      WHERE d.status = 'PUBLISHED' AND r.strength_class IS NOT NULL
      GROUP BY r.strength_class ORDER BY r.strength_class`,
  );

  // The spread per strength class is the sector's central argument, so the
  // federation's landing page leads with it rather than with a mean.
  const spread = [];
  for (const cls of classes) {
    const aggregation = await buildAggregation({ strengthClass: cls.code, method: 'VOLUME_WEIGHTED' });
    if (!aggregation.sampleSize) continue;
    spread.push({
      strengthClass: cls.code,
      indicator: LEAD_INDICATOR,
      unit: aggregation.lead.unit,
      n: aggregation.sampleSize,
      mean: aggregation.lead.mean,
      weightedMean: aggregation.lead.weightedMean,
      min: aggregation.lead.min,
      max: aggregation.lead.max,
      spreadPct: aggregation.lead.spreadPct,
      cv: aggregation.lead.cv,
    });
  }

  const settings = await allSettings();

  return {
    stats: [
      { key: 'producers', label: 'Aangesloten producenten', value: await scalar("SELECT COUNT(*) AS n FROM organisations WHERE type = 'PRODUCER'") },
      { key: 'suppliers', label: 'Grondstofleveranciers', value: await scalar("SELECT COUNT(*) AS n FROM organisations WHERE type = 'SUPPLIER'") },
      { key: 'published', label: 'Gepubliceerde declaraties', value: await scalar("SELECT COUNT(*) AS n FROM declarations WHERE status = 'PUBLISHED'"), tone: 'ok' },
      {
        key: 'invalid',
        label: 'Dossiers zonder volledige BEPD-dekking',
        value: await scalar("SELECT COUNT(*) AS n FROM declarations WHERE verdict <> 'VALID'"),
        tone: 'warn',
      },
    ],
    spread,
    aggregations: await all('SELECT id, label, strength_class, sample_size, created_at, published FROM aggregations ORDER BY created_at DESC LIMIT 10'),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    coverage: await all(
      `SELECT o.name, o.type,
              (SELECT COUNT(*) FROM materials m WHERE m.org_id = o.id AND m.archived = 0) AS materials,
              (SELECT COUNT(*) FROM declarations d WHERE d.org_id = o.id AND d.status = 'PUBLISHED') AS published
         FROM organisations o
        WHERE o.type IN ('SUPPLIER', 'PRODUCER')
        ORDER BY o.type, o.name`,
    ),
  };
}

async function scalar(sql, params = []) {
  const row = await get(sql, params);
  return Number(row?.n ?? 0);
}

export default router;
