/**
 * Projects, deliveries and the continuous go / no-go.
 *
 * Modules A4 and A5 only exist per delivery: the transport leg and the way the
 * concrete is placed depend on the site, not on the recipe. Whoever was
 * assigned the module on the project is the only party that may fill it in,
 * and the audit log records who did - "log eens in met mijn account" is exactly
 * what this prevents.
 */
import { Router } from '../router.js';
import { all, get, run, getSettingNumber } from '../../db/index.js';
import { ok, created, str, num, bool, notFound, badRequest } from '../respond.js';
import { id } from '../../lib/ids.js';
import { record, notify, forEntity } from '../../lib/audit.js';
import { requireCap, isOversight, requireResponsibility, Forbidden } from '../../domain/permissions.js';
import { calculateRecipeVersion } from '../../domain/calc.js';
import { recipeVersionAt, nowIso } from '../../domain/versioning.js';
import { effectiveDeclarationFor, writeGateCheck } from '../../domain/declarations.js';
import { deliverable } from '../../domain/validity.js';
import { defaultParameters } from '../../db/seed.js';
import { CONSTRUCTION_MODULES, GATE_DECISIONS, PARAMETER_DEFS, DECLARATION_STATUS_LABELS } from '../../domain/constants.js';

const router = new Router();

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

router.get('/projects', async ({ res, user }) => {
  // A producer sees the projects it delivers to; a contractor sees its own.
  const projects = await all(
    isOversight(user)
      ? `SELECT p.*, o.name AS owner_name FROM projects p JOIN organisations o ON o.id = p.org_id WHERE p.archived = 0 ORDER BY p.created_at DESC`
      : `SELECT DISTINCT p.*, o.name AS owner_name
           FROM projects p
           JOIN organisations o ON o.id = p.org_id
           LEFT JOIN deliveries d ON d.project_id = p.id
          WHERE p.archived = 0 AND (p.org_id = ? OR d.producer_org_id = ? OR d.contractor_org_id = ?)
          ORDER BY p.created_at DESC`,
    isOversight(user) ? [] : [user.orgId, user.orgId, user.orgId],
  );

  for (const project of projects) {
    const stats = await get(
      'SELECT COUNT(*) AS n, COALESCE(SUM(volume_m3), 0) AS volume FROM deliveries WHERE project_id = ?',
      [project.id],
    );
    project.deliveryCount = Number(stats?.n ?? 0);
    project.volumeM3 = Number(stats?.volume ?? 0);
  }

  ok(res, { projects });
});

router.post('/projects', async ({ res, user, body }) => {
  requireCap(user, 'projects:write', 'Alleen een aannemer kan projecten aanmaken.');

  const projectId = id('prj');
  await run(
    `INSERT INTO projects (id, org_id, name, reference, address, city, architect, note, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      projectId,
      user.orgId,
      str(body.name, 'naam', { required: true, max: 200 }),
      str(body.reference, 'referentie', { max: 64 }),
      str(body.address, 'adres'),
      str(body.city, 'gemeente'),
      str(body.architect, 'architect'),
      str(body.note, 'nota'),
      nowIso(),
    ],
  );

  // Without an explicit assignment nobody may enter A4/A5, so the creator gets
  // both by default and can hand A4 to the producer afterwards.
  for (const module of CONSTRUCTION_MODULES) {
    await run('INSERT INTO project_responsibilities (project_id, module, org_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)', [
      projectId,
      module,
      user.orgId,
      user.id,
      nowIso(),
    ]);
  }

  await record(user, 'PROJECT_CREATED', { type: 'PROJECT', id: projectId }, `Project ${body.name} aangemaakt.`);
  created(res, { project: await get('SELECT * FROM projects WHERE id = ?', [projectId]) });
});

router.get('/projects/:id', async ({ res, user, params }) => {
  const project = await get(
    'SELECT p.*, o.name AS owner_name FROM projects p JOIN organisations o ON o.id = p.org_id WHERE p.id = ?',
    [params.id],
  );
  if (!project) throw notFound('Project niet gevonden.');

  const deliveries = await all(
    `SELECT d.*, r.code AS recipe_code, r.name AS recipe_name, r.strength_class,
            rv.version_no, p.name AS producer_name, c.name AS contractor_name
       FROM deliveries d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN organisations p ON p.id = d.producer_org_id
       JOIN organisations c ON c.id = d.contractor_org_id
      WHERE d.project_id = ?
      ORDER BY d.delivered_at DESC`,
    [params.id],
  );

  const involved =
    project.org_id === user.orgId || deliveries.some((d) => d.producer_org_id === user.orgId || d.contractor_org_id === user.orgId);
  if (!involved && !isOversight(user)) throw new Forbidden('U bent geen partij op dit project.');

  const responsibilities = await all(
    `SELECT pr.*, o.name AS org_name FROM project_responsibilities pr
       JOIN organisations o ON o.id = pr.org_id WHERE pr.project_id = ?`,
    [params.id],
  );

  ok(res, { project, deliveries, responsibilities, audit: await forEntity('PROJECT', params.id, 40) });
});

/**
 * Hand a module to another party. Sometimes the producer delivers with its own
 * mixers (A4 is theirs), sometimes the contractor collects (A4 is the
 * contractor's). Somebody has to say which, in writing.
 */
router.post('/projects/:id/responsibilities', async ({ res, user, params, body }) => {
  requireCap(user, 'projects:write');
  const project = await get('SELECT * FROM projects WHERE id = ?', [params.id]);
  if (!project) throw notFound('Project niet gevonden.');
  if (project.org_id !== user.orgId) throw new Forbidden('Alleen de projecteigenaar wijst verantwoordelijkheden toe.');

  const module = str(body.module, 'module', { required: true });
  if (!CONSTRUCTION_MODULES.includes(module)) throw badRequest('Alleen A4 en A5 worden per project toegewezen.');

  const orgId = str(body.orgId, 'organisatie', { required: true });
  const org = await get('SELECT * FROM organisations WHERE id = ?', [orgId]);
  if (!org) throw notFound('Organisatie niet gevonden.');

  await run(
    `INSERT INTO project_responsibilities (project_id, module, org_id, assigned_by, assigned_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id, module) DO UPDATE SET org_id = excluded.org_id, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
    [params.id, module, orgId, user.id, nowIso()],
  );

  await record(user, 'RESPONSIBILITY_ASSIGNED', { type: 'PROJECT', id: params.id }, `Module ${module} toegewezen aan ${org.name}.`);
  await notify(orgId, 'RESPONSIBILITY', `U bent verantwoordelijk voor module ${module}`, `Project ${project.name}.`, `#/projects/${params.id}`);

  ok(res, { responsibilities: await all('SELECT * FROM project_responsibilities WHERE project_id = ?', [params.id]) });
});

/* ------------------------------------------------------------------ */
/* Deliveries                                                          */
/* ------------------------------------------------------------------ */

router.post('/projects/:id/deliveries', async ({ res, user, params, body }) => {
  requireCap(user, 'deliveries:write', 'Alleen een aannemer registreert leveringen op zijn project.');
  const project = await get('SELECT * FROM projects WHERE id = ?', [params.id]);
  if (!project) throw notFound('Project niet gevonden.');

  const deliveredAt = str(body.deliveredAt, 'leveringsdatum') ?? nowIso();
  const recipeId = str(body.recipeId, 'receptuur', { required: true });

  // Pin the version that was actually in force at the moment of delivery, not
  // whatever the recipe looks like today.
  const version = await recipeVersionAt(recipeId, deliveredAt);
  if (!version) throw badRequest('Voor deze receptuur was op de leveringsdatum geen actieve versie van kracht.');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [recipeId]);

  const deliveryId = id('dlv');
  await run(
    `INSERT INTO deliveries (id, project_id, recipe_version_id, producer_org_id, contractor_org_id, delivery_note,
                             volume_m3, delivered_at, distance_km, transport_profile_id, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?)`,
    [
      deliveryId,
      params.id,
      version.id,
      recipe.org_id,
      project.org_id,
      str(body.deliveryNote, 'bonnummer', { max: 64 }),
      num(body.volumeM3, 'volume', { required: true, min: 0, max: 10000 }),
      deliveredAt,
      num(body.distanceKm, 'afstand', { min: 0, max: 2000 }) ?? 0,
      str(body.transportProfileId, 'transportprofiel') ?? (await defaultMixerProfile()),
      user.id,
      nowIso(),
    ],
  );

  for (const p of await defaultParameters(['A5'])) {
    await run(
      'INSERT INTO delivery_parameters (id, delivery_id, code, value, unit, source, overridden, justification, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
      [id('dp'), deliveryId, p.code, p.value, p.unit, p.source, user.id, nowIso()],
    );
  }

  await record(user, 'DELIVERY_CREATED', { type: 'DELIVERY', id: deliveryId }, `Levering van ${body.volumeM3} m³ ${recipe.code} geregistreerd.`);
  created(res, { delivery: await get('SELECT * FROM deliveries WHERE id = ?', [deliveryId]) });
});

router.get('/deliveries/:id', async ({ res, user, params }) => {
  const delivery = await loadDelivery(params.id, user);
  const parameters = await all('SELECT * FROM delivery_parameters WHERE delivery_id = ?', [params.id]);

  const result = await calculateRecipeVersion(delivery.recipe_version_id, {
    scope: 'A1-A5',
    at: delivery.delivered_at,
    site: { distanceKm: delivery.distance_km, transportProfileId: delivery.transport_profile_id },
    siteParameters: parameters,
    volumeM3: delivery.volume_m3,
  });

  const responsibilities = await all(
    `SELECT pr.*, o.name AS org_name FROM project_responsibilities pr
       JOIN organisations o ON o.id = pr.org_id WHERE pr.project_id = ?`,
    [delivery.project_id],
  );

  ok(res, {
    delivery,
    parameters,
    parameterDefs: PARAMETER_DEFS.filter((p) => p.module === 'A5'),
    responsibilities,
    result,
    gates: await all("SELECT * FROM gate_checks WHERE subject_type = 'DELIVERY' AND subject_id = ? ORDER BY created_at DESC", [params.id]),
    audit: await forEntity('DELIVERY', params.id, 30),
  });
});

/** A4/A5 parameters, writable only by the party that carries the module. */
router.patch('/deliveries/:id/parameters', async ({ res, user, params, body }) => {
  const delivery = await loadDelivery(params.id, user);
  await requireResponsibility(user, delivery.project_id, 'A5');

  const allowed = new Set(PARAMETER_DEFS.filter((p) => p.module === 'A5').map((p) => p.code));
  const applied = [];

  for (const parameter of body.parameters ?? []) {
    if (!allowed.has(parameter.code)) continue;
    const overridden = bool(parameter.overridden);
    if (overridden && !str(parameter.justification, 'verantwoording')) {
      throw badRequest(`Parameter "${parameter.code}" wijkt af van de sectorwaarde. Geef een verantwoording op.`);
    }
    const value = num(parameter.value, parameter.code, { required: true, min: 0 });

    await run(
      `INSERT INTO delivery_parameters (id, delivery_id, code, value, unit, source, overridden, justification, entered_by, entered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (delivery_id, code) DO UPDATE SET
         value = excluded.value, unit = excluded.unit, source = excluded.source,
         overridden = excluded.overridden, justification = excluded.justification,
         entered_by = excluded.entered_by, entered_at = excluded.entered_at`,
      [
        id('dp'),
        params.id,
        parameter.code,
        value,
        str(parameter.unit, 'eenheid') ?? '',
        overridden ? 'MEASURED' : 'SECTOR_DEFAULT',
        overridden ? 1 : 0,
        str(parameter.justification, 'verantwoording'),
        user.id,
        nowIso(),
      ],
    );
    applied.push({ code: parameter.code, value, overridden });
  }

  await record(user, 'DELIVERY_PARAMETERS_UPDATED', { type: 'DELIVERY', id: params.id }, `Werfparameters (A5) ingevuld door ${user.orgName}.`, { applied });
  ok(res, { parameters: await all('SELECT * FROM delivery_parameters WHERE delivery_id = ?', [params.id]) });
});

/* ------------------------------------------------------------------ */
/* The go / no-go                                                      */
/* ------------------------------------------------------------------ */

/**
 * The continuous check that replaces batch auditing.
 *
 * Note what it is not: it does not stop a truck. The platform reports whether
 * the declaration covering this delivery is valid; the producer remains
 * responsible for the concrete it ships, exactly as it is today. A NO_GO means
 * "this delivery cannot be declared as verified", not "this concrete may not
 * leave" - which is also why the manual override below exists and is logged
 * rather than blocked.
 */
router.post('/deliveries/:id/gate', async ({ res, user, params }) => {
  const delivery = await loadDelivery(params.id, user);
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [delivery.recipe_version_id]);
  const declaration = await effectiveDeclarationFor(version.recipe_id, delivery.delivered_at);

  const parameters = await all('SELECT * FROM delivery_parameters WHERE delivery_id = ?', [params.id]);
  const result = await calculateRecipeVersion(delivery.recipe_version_id, {
    scope: 'A1-A5',
    at: delivery.delivered_at,
    site: { distanceKm: delivery.distance_km, transportProfileId: delivery.transport_profile_id },
    siteParameters: parameters,
  });

  const reasons = [];
  let decision = GATE_DECISIONS.GO;

  if (!declaration) {
    decision = GATE_DECISIONS.NO_GO;
    reasons.push({
      code: 'NO_DECLARATION',
      passed: false,
      message: 'Er was op de leveringsdatum geen geldige declaratie van kracht voor deze receptuur.',
    });
  } else {
    reasons.push({
      code: 'DECLARATION_IN_FORCE',
      passed: true,
      message: `Declaratie ${declaration.certificate_no ?? declaration.id} (${DECLARATION_STATUS_LABELS[declaration.status] ?? declaration.status}) was van kracht op ${delivery.delivered_at.slice(0, 10)}.`,
    });
  }

  if (!deliverable(result.verdict)) {
    decision = GATE_DECISIONS.NO_GO;
    reasons.push({ code: 'VERDICT', passed: false, message: `Het rekenresultaat is "${result.verdict}". ${result.reasons[0]?.message ?? ''}` });
  } else if (result.verdict !== 'VALID') {
    if (decision === GATE_DECISIONS.GO) decision = GATE_DECISIONS.GO_WITH_WARNING;
    reasons.push({ code: 'VERDICT', passed: true, message: `Het resultaat is bruikbaar maar gemerkt: ${result.verdict}.` });
  } else {
    reasons.push({ code: 'VERDICT', passed: true, message: 'Alle grondstoffen zijn BEPD-gedekt op de leveringsdatum.' });
  }

  const missingA5 = parameters.length === 0;
  if (missingA5) {
    if (decision === GATE_DECISIONS.GO) decision = GATE_DECISIONS.GO_WITH_WARNING;
    reasons.push({ code: 'A5_MISSING', passed: false, message: 'De werfparameters (A5) zijn nog niet ingevuld door de verantwoordelijke partij.' });
  }

  const tolerance = await getSettingNumber('delivery_tolerance_pct', 3);
  let deviationPct = null;
  if (declaration?.result_json) {
    const declared = JSON.parse(declaration.result_json).totals?.GWP_TOTAL ?? 0;
    const actualA1A3 = ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (result.byModule?.[m]?.GWP_TOTAL ?? 0), 0);
    deviationPct = declared ? ((actualA1A3 - declared) / declared) * 100 : 0;

    const within = Math.abs(deviationPct) <= tolerance;
    if (!within && decision !== GATE_DECISIONS.NO_GO) decision = GATE_DECISIONS.GO_WITH_WARNING;
    reasons.push({
      code: 'DEVIATION',
      passed: within,
      message: `Afwijking van de geleverde samenstelling t.o.v. de gedeclareerde: ${deviationPct.toFixed(2).replace('.', ',')} % (marge ± ${tolerance} %).`,
    });
  }

  await writeGateCheck({
    subjectType: 'DELIVERY',
    subjectId: params.id,
    decision,
    verdict: result.verdict,
    deviationPct,
    thresholdPct: tolerance,
    reasons,
    actor: user,
    note: null,
  });

  await run('UPDATE deliveries SET result_json = ? WHERE id = ?', [JSON.stringify(result), params.id]);

  if (decision === GATE_DECISIONS.NO_GO) {
    await notify(
      delivery.producer_org_id,
      'GATE_NO_GO',
      `Levering ${delivery.delivery_note ?? params.id} kan niet geverifieerd worden`,
      reasons.find((r) => !r.passed)?.message ?? null,
      `#/deliveries/${params.id}`,
    );
  }

  await record(user, 'DELIVERY_GATE_CHECK', { type: 'DELIVERY', id: params.id }, `Controle uitgevoerd: ${decision}.`, { reasons, deviationPct });

  ok(res, { decision, verdict: result.verdict, deviationPct, thresholdPct: tolerance, reasons, result });
});

/**
 * The manual override. When the platform is unavailable or a check cannot be
 * completed, work does not stop - the producer accepts responsibility in
 * writing and the record shows exactly who did, when and why.
 */
router.post('/deliveries/:id/override', async ({ res, user, params, body }) => {
  const delivery = await loadDelivery(params.id, user);
  if (delivery.producer_org_id !== user.orgId && delivery.contractor_org_id !== user.orgId) {
    throw new Forbidden('Alleen de leverende of afnemende partij kan een uitzondering vastleggen.');
  }
  const justification = str(body.justification, 'verantwoording', { required: true, max: 4000 });

  await writeGateCheck({
    subjectType: 'DELIVERY',
    subjectId: params.id,
    decision: GATE_DECISIONS.MANUAL_OVERRIDE,
    verdict: null,
    reasons: [{ code: 'MANUAL_OVERRIDE', passed: true, message: justification }],
    actor: user,
    note: justification,
  });

  await record(
    user,
    'DELIVERY_OVERRIDE',
    { type: 'DELIVERY', id: params.id },
    `Uitzondering vastgelegd door ${user.name} (${user.orgName}): de levering gaat door onder eigen verantwoordelijkheid.`,
    { justification },
  );

  ok(res, { ok: true, decision: GATE_DECISIONS.MANUAL_OVERRIDE });
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function loadDelivery(deliveryId, user) {
  const delivery = await get(
    `SELECT d.*, r.code AS recipe_code, r.name AS recipe_name, r.strength_class, r.density,
            rv.version_no, pr.name AS project_name
       FROM deliveries d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN projects pr ON pr.id = d.project_id
      WHERE d.id = ?`,
    [deliveryId],
  );
  if (!delivery) throw notFound('Levering niet gevonden.');
  if (delivery.producer_org_id !== user.orgId && delivery.contractor_org_id !== user.orgId && !isOversight(user)) {
    throw new Forbidden('U bent geen partij bij deze levering.');
  }
  return delivery;
}

async function defaultMixerProfile() {
  const row = await get("SELECT id FROM transport_profiles WHERE code = 'MIXER_8M3' ORDER BY valid_from DESC LIMIT 1");
  return row?.id ?? null;
}

export default router;
