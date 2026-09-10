/**
 * Raw materials and the declarations behind them - the supplier's side of the
 * platform, and the catalogue the producers shop in.
 */
import { Router } from '../router.js';
import { all, get, run } from '../../db/index.js';
import { ok, created, str, num, bool, oneOf, badRequest, notFound } from '../respond.js';
import { id } from '../../lib/ids.js';
import { record } from '../../lib/audit.js';
import { requireCap, canReadMaterialData, ownsOrThrow, isOversight, redactMaterial } from '../../domain/permissions.js';
import { evaluateEvidence, evaluateModuleCoverage, rollup } from '../../domain/validity.js';
import {
  createMaterialVersion,
  materialVersionAt,
  materialVersions,
  materialValues,
  declaredModules,
  nowIso,
} from '../../domain/versioning.js';
import { MATERIAL_CATEGORIES, EVIDENCE_TYPE_CODES, MODULE_CODES, INDICATOR_CODES } from '../../domain/constants.js';

const router = new Router();

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/**
 * The catalogue. Every listed supplier's materials are visible by name and
 * category; the environmental numbers are replaced by a `restricted` marker
 * unless the viewer owns them or has a granted access request. Discovery has to
 * work without disclosure, otherwise a producer cannot even ask for access.
 */
router.get('/materials', async ({ res, user, query }) => {
  const clauses = ['m.archived = 0'];
  const params = [];

  if (query.scope === 'own') {
    clauses.push('m.org_id = ?');
    params.push(user.orgId);
  } else {
    clauses.push('(o.listed = 1 OR m.org_id = ?)');
    params.push(user.orgId);
  }
  if (query.category) {
    clauses.push('m.category = ?');
    params.push(query.category);
  }
  if (query.supplier) {
    clauses.push('m.org_id = ?');
    params.push(query.supplier);
  }
  if (query.q) {
    clauses.push('(lower(m.name) LIKE lower(?) OR lower(m.code) LIKE lower(?) OR lower(o.name) LIKE lower(?))');
    params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }

  const rows = await all(
    `SELECT m.*, o.name AS supplier_name, s.name AS site_name, s.city AS site_city
       FROM materials m
       JOIN organisations o ON o.id = m.org_id
       LEFT JOIN sites s ON s.id = m.site_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY o.name, m.category, m.name`,
    params,
  );

  const at = query.at ?? nowIso();
  const materials = [];
  for (const row of rows) {
    const readable = await canReadMaterialData(user, row);
    const summary = await materialSummary(row, at, { withValues: readable });
    materials.push(readable ? summary : { ...redactMaterial(row), ...publicFacts(summary) });
  }

  ok(res, { materials, at });
});

router.get('/materials/:id', async ({ res, user, params, query }) => {
  const material = await get(
    `SELECT m.*, o.name AS supplier_name, o.listed, s.name AS site_name, s.city AS site_city
       FROM materials m JOIN organisations o ON o.id = m.org_id
       LEFT JOIN sites s ON s.id = m.site_id
      WHERE m.id = ?`,
    [params.id],
  );
  if (!material) throw notFound('Grondstof niet gevonden.');

  const readable = await canReadMaterialData(user, material);
  const at = query.at ?? nowIso();
  const summary = await materialSummary(material, at, { withValues: readable });

  if (!readable) {
    return ok(res, {
      material: { ...redactMaterial(material), ...publicFacts(summary) },
      versions: [],
      restricted: true,
      hint: 'Vraag toegang aan bij de leverancier om de milieuparameters te kunnen inkijken.',
    });
  }

  const versions = [];
  for (const version of await materialVersions(params.id)) {
    const evidence = version.evidence_id ? await get('SELECT * FROM evidence WHERE id = ?', [version.evidence_id]) : null;
    versions.push({
      ...version,
      evidence,
      values: await materialValues(version.id),
      modules: await declaredModules(version.id),
    });
  }

  ok(res, { material: summary, versions, restricted: false });
});

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

router.post('/materials', async ({ res, user, body }) => {
  requireCap(user, 'materials:write', 'Alleen een grondstofleverancier kan grondstoffen registreren.');

  const category = oneOf(body.category, MATERIAL_CATEGORIES.map((c) => c.code), 'categorie', { required: true });
  const materialId = id('mat');

  await run(
    `INSERT INTO materials (id, org_id, site_id, code, name, category, declared_unit, density, description, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      materialId,
      user.orgId,
      str(body.siteId, 'productielocatie'),
      str(body.code, 'code', { required: true, max: 64 }),
      str(body.name, 'naam', { required: true, max: 200 }),
      category,
      oneOf(body.declaredUnit, ['TONNE', 'KG', 'M3'], 'declared unit') ?? 'TONNE',
      num(body.density, 'densiteit', { min: 0, max: 10000 }),
      str(body.description, 'omschrijving'),
      nowIso(),
    ],
  );

  const evidenceId = await upsertEvidence(body.evidence, user);
  const version = await createMaterialVersion(
    {
      materialId,
      effectiveFrom: str(body.effectiveFrom, 'geldig vanaf') ?? nowIso(),
      evidenceId,
      includesInboundTransport: bool(body.includesInboundTransport),
      changeReason: str(body.changeReason, 'reden') ?? 'Initiële registratie.',
      values: sanitiseValues(body.values),
    },
    user,
  );

  await record(user, 'MATERIAL_CREATED', { type: 'MATERIAL', id: materialId }, `Grondstof ${body.code} — ${body.name} geregistreerd.`, {
    versionId: version.id,
  });

  const material = await get(
    `SELECT m.*, o.name AS supplier_name FROM materials m JOIN organisations o ON o.id = m.org_id WHERE m.id = ?`,
    [materialId],
  );
  created(res, { material: await materialSummary(material, nowIso(), { withValues: true }) });
});

/**
 * A new version rather than an edit. The supplier's kiln changes, the numbers
 * change, and a delivery made last month must keep resolving to the numbers
 * that were true last month.
 */
router.post('/materials/:id/versions', async ({ res, user, params, body }) => {
  requireCap(user, 'materials:write');
  const material = await get('SELECT * FROM materials WHERE id = ?', [params.id]);
  if (!material) throw notFound('Grondstof niet gevonden.');
  ownsOrThrow(user, material.org_id, 'U kunt alleen de eigen grondstoffen bijwerken.');

  const evidenceId = body.evidenceId ? str(body.evidenceId, 'bewijsstuk') : await upsertEvidence(body.evidence, user);
  const version = await createMaterialVersion(
    {
      materialId: params.id,
      effectiveFrom: str(body.effectiveFrom, 'geldig vanaf') ?? nowIso(),
      evidenceId,
      includesInboundTransport: bool(body.includesInboundTransport),
      changeReason: str(body.changeReason, 'reden voor wijziging', { required: true }),
      values: sanitiseValues(body.values),
    },
    user,
  );

  await record(
    user,
    'MATERIAL_VERSION_CREATED',
    { type: 'MATERIAL', id: params.id },
    `Nieuwe versie v${version.version_no} van ${material.code}, geldig vanaf ${version.effective_from.slice(0, 10)}.`,
    { reason: body.changeReason, versionId: version.id },
  );

  created(res, { version });
});

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

router.get('/evidence', async ({ res, user, query }) => {
  const orgId = isOversight(user) && query.orgId ? query.orgId : user.orgId;
  ok(res, {
    evidence: await all(
      `SELECT e.*, (SELECT COUNT(*) FROM material_versions mv WHERE mv.evidence_id = e.id) AS use_count
         FROM evidence e WHERE e.org_id = ? ORDER BY e.created_at DESC`,
      [orgId],
    ),
  });
});

router.post('/evidence', async ({ res, user, body }) => {
  requireCap(user, 'evidence:write');
  const evidenceId = await upsertEvidence(body, user, { required: true });
  await record(user, 'EVIDENCE_CREATED', { type: 'EVIDENCE', id: evidenceId }, `Bewijsstuk ${body.type} ${body.number ?? ''} toegevoegd.`);
  created(res, { evidence: await get('SELECT * FROM evidence WHERE id = ?', [evidenceId]) });
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function upsertEvidence(input, user, { required = false } = {}) {
  if (!input) {
    if (required) throw badRequest('Er is geen bewijsstuk meegegeven.');
    return null;
  }
  const type = oneOf(input.type, EVIDENCE_TYPE_CODES, 'documenttype', { required: true });
  const number = str(input.number, 'registratienummer', { max: 120 });

  // The rule is enforced here as well as in the verdict, so a supplier gets a
  // clear message at entry rather than an unexplained "INVALID" three screens
  // later.
  if ((type === 'BEPD' || type === 'EPD_INTL') && !number) {
    throw badRequest('Een BEPD of internationale EPD kan alleen worden opgeslagen met haar registratienummer. Zonder nummer is de verklaring niet controleerbaar.');
  }

  const evidenceId = id('ev');
  await run(
    `INSERT INTO evidence (id, org_id, type, number, programme, issuer, valid_from, valid_until, document_url, scope_modules, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evidenceId,
      user.orgId,
      type,
      number,
      str(input.programme, 'programma', { max: 200 }),
      str(input.issuer, 'verificateur', { max: 200 }),
      str(input.validFrom, 'geldig vanaf'),
      str(input.validUntil, 'geldig tot'),
      str(input.documentUrl, 'documentlink', { max: 600 }),
      str(input.scopeModules, 'modules') ?? 'A1,A2,A3',
      str(input.note, 'nota'),
      user.id,
      nowIso(),
    ],
  );
  return evidenceId;
}

/** Keep only recognised module/indicator combinations and finite numbers. */
function sanitiseValues(values) {
  const out = {};
  for (const [module, byIndicator] of Object.entries(values ?? {})) {
    if (!MODULE_CODES.includes(module)) continue;
    for (const [indicator, raw] of Object.entries(byIndicator ?? {})) {
      if (!INDICATOR_CODES.includes(indicator)) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      (out[module] ??= {})[indicator] = n;
    }
  }
  return out;
}

/**
 * One material with its current version, evidence and verdict.
 *
 * This is an N+1 query per material and it is fine at sector scale (a few
 * thousand rows); if the catalogue ever gets slow the fix is a joined view, not
 * a cache, because staleness here would show wrong verdicts.
 */
export async function materialSummary(material, at = nowIso(), { withValues = true } = {}) {
  const version = (await materialVersionAt(material.id, at)) ?? (await get('SELECT * FROM material_versions WHERE material_id = ? ORDER BY version_no DESC LIMIT 1', [material.id]));
  const evidence = version?.evidence_id ? await get('SELECT * FROM evidence WHERE id = ?', [version.evidence_id]) : null;
  const label = `${material.name} (${material.supplier_name ?? ''})`.trim();

  const judgements = [evaluateEvidence(evidence, at, label)];
  if (version) {
    const categoryRule = await get('SELECT * FROM category_rules WHERE category = ?', [material.category]);
    judgements.push(evaluateModuleCoverage(await declaredModules(version.id), categoryRule, label));
  }
  const { verdict, reasons } = rollup(judgements);

  return {
    id: material.id,
    org_id: material.org_id,
    supplier_name: material.supplier_name,
    site_name: material.site_name ?? null,
    site_city: material.site_city ?? null,
    code: material.code,
    name: material.name,
    category: material.category,
    declared_unit: material.declared_unit,
    density: material.density,
    description: material.description,
    restricted: false,
    version: version ? { id: version.id, version_no: version.version_no, effective_from: version.effective_from, includes_inbound_transport: !!version.includes_inbound_transport } : null,
    evidence,
    evidence_type: evidence?.type ?? null,
    verdict,
    reasons,
    values: withValues && version ? await materialValues(version.id) : null,
  };
}

/**
 * What a producer may see about a material it has no access to: enough to
 * recognise it and decide whether to request access, and nothing numeric.
 */
function publicFacts(summary) {
  return {
    evidence_type: summary.evidence_type,
    verdict: summary.verdict,
    site_name: summary.site_name,
    site_city: summary.site_city,
    version: summary.version ? { version_no: summary.version.version_no, effective_from: summary.version.effective_from } : null,
  };
}

export default router;
