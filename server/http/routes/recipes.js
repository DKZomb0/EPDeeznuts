/**
 * Recipes: the producer's side. A recipe is a container; all the substance sits
 * in its versions, because the mix changes constantly and every past state has
 * to stay reconstructable.
 */
import { Router } from '../router.js';
import { all, get, run } from '../../db/index.js';
import { ok, created, str, num, bool, oneOf, badRequest, notFound } from '../respond.js';
import { id } from '../../lib/ids.js';
import { record, forEntity } from '../../lib/audit.js';
import { requireCap, ownsOrThrow, isOversight, canReadMaterialData, Forbidden } from '../../domain/permissions.js';
import {
  createRecipeVersion,
  activateRecipeVersion,
  recipeVersions,
  activeRecipeVersion,
  currentRecipeVersion,
  materialVersionAt,
  componentsOf,
  parametersOf,
  nowIso,
} from '../../domain/versioning.js';
import { calculateRecipeVersion } from '../../domain/calc.js';
import { evaluateChange } from '../../domain/changes.js';
import { effectiveDeclarationFor } from '../../domain/declarations.js';
import { defaultParameters } from '../../db/seed.js';
import { PARAMETER_DEFS, SCOPES } from '../../domain/constants.js';
import { buildReport } from '../../domain/report.js';

const router = new Router();

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

router.get('/recipes', async ({ res, user, query }) => {
  const clauses = ['r.archived = 0'];
  const params = [];
  if (!isOversight(user) || query.scope === 'own') {
    clauses.push('r.org_id = ?');
    params.push(user.orgId);
  }
  if (query.strengthClass) {
    clauses.push('r.strength_class = ?');
    params.push(query.strengthClass);
  }
  if (query.q) {
    clauses.push('(lower(r.code) LIKE lower(?) OR lower(r.name) LIKE lower(?))');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }

  const rows = await all(
    `SELECT r.*, o.name AS producer_name, s.name AS site_name
       FROM recipes r
       JOIN organisations o ON o.id = r.org_id
       LEFT JOIN sites s ON s.id = r.site_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.code`,
    params,
  );

  const recipes = [];
  for (const recipe of rows) {
    const version = (await activeRecipeVersion(recipe.id)) ?? (await currentRecipeVersion(recipe.id));
    const declaration = await effectiveDeclarationFor(recipe.id);
    let lead = null;
    let verdict = null;
    if (version) {
      // Reading the stored snapshot where one exists keeps the list cheap and,
      // more importantly, shows the figure that was actually declared.
      if (declaration?.result_json) {
        const parsed = JSON.parse(declaration.result_json);
        lead = parsed.totals?.GWP_TOTAL ?? null;
        verdict = parsed.verdict;
      } else {
        const result = await calculateRecipeVersion(version.id, { scope: 'A1-A3' });
        lead = result.totals.GWP_TOTAL;
        verdict = result.verdict;
      }
    }
    recipes.push({
      ...recipe,
      version,
      versionCount: (await recipeVersions(recipe.id)).length,
      declaration: declaration ? { id: declaration.id, status: declaration.status, certificate_no: declaration.certificate_no, valid_until: declaration.valid_until } : null,
      lead,
      verdict,
    });
  }

  ok(res, { recipes });
});

router.get('/recipes/:id', async ({ res, user, params }) => {
  const recipe = await get(
    `SELECT r.*, o.name AS producer_name, s.name AS site_name
       FROM recipes r JOIN organisations o ON o.id = r.org_id
       LEFT JOIN sites s ON s.id = r.site_id WHERE r.id = ?`,
    [params.id],
  );
  if (!recipe) throw notFound('Receptuur niet gevonden.');
  if (recipe.org_id !== user.orgId && !isOversight(user)) throw new Forbidden('Deze receptuur hoort bij een andere producent.');

  const versions = [];
  for (const version of await recipeVersions(params.id)) {
    const declaration = await get(
      "SELECT id, status, verdict, certificate_no, bypass_of, bypass_deviation FROM declarations WHERE recipe_version_id = ? AND status <> 'REJECTED' ORDER BY created_at DESC LIMIT 1",
      [version.id],
    );
    versions.push({ ...version, declaration });
  }

  ok(res, {
    recipe,
    versions,
    history: await forEntity('RECIPE', params.id, 50),
  });
});

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

router.post('/recipes', async ({ res, user, body }) => {
  requireCap(user, 'recipes:write', 'Alleen een betonproducent kan recepturen aanmaken.');

  const recipeId = id('rec');
  await run(
    `INSERT INTO recipes (id, org_id, site_id, code, name, strength_class, exposure_classes, consistency, dmax, density, benor, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      recipeId,
      user.orgId,
      str(body.siteId, 'centrale'),
      str(body.code, 'code', { required: true, max: 64 }),
      str(body.name, 'naam', { required: true, max: 200 }),
      str(body.strengthClass, 'sterkteklasse'),
      str(body.exposureClasses, 'omgevingsklassen'),
      str(body.consistency, 'consistentieklasse'),
      num(body.dmax, 'Dmax', { min: 0, max: 200 }),
      num(body.density, 'densiteit', { min: 500, max: 5000 }) ?? 2350,
      bool(body.benor),
      nowIso(),
    ],
  );

  const components = await resolveComponents(body.components ?? [], user, body.effectiveFrom);
  const parameters = body.parameters?.length ? sanitiseParameters(body.parameters, ['A3']) : await defaultParameters(['A3']);

  const version = await createRecipeVersion(
    {
      recipeId,
      effectiveFrom: str(body.effectiveFrom, 'geldig vanaf') ?? nowIso(),
      status: body.activate === false ? 'DRAFT' : 'ACTIVE',
      components,
      parameters,
      changeReason: str(body.changeReason, 'reden') ?? 'Initiële receptuur.',
    },
    user,
  );

  await record(user, 'RECIPE_CREATED', { type: 'RECIPE', id: recipeId }, `Receptuur ${body.code} aangemaakt.`, { versionId: version.id });
  created(res, { recipe: await get('SELECT * FROM recipes WHERE id = ?', [recipeId]), version });
});

router.post('/recipes/:id/versions', async ({ res, user, params, body }) => {
  requireCap(user, 'recipes:write');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [params.id]);
  if (!recipe) throw notFound('Receptuur niet gevonden.');
  ownsOrThrow(user, recipe.org_id);

  const effectiveFrom = str(body.effectiveFrom, 'geldig vanaf') ?? nowIso();
  const components = body.components ? await resolveComponents(body.components, user, effectiveFrom) : undefined;
  const parameters = body.parameters ? sanitiseParameters(body.parameters, ['A3']) : undefined;

  const version = await createRecipeVersion(
    {
      recipeId: params.id,
      effectiveFrom,
      status: body.activate ? 'ACTIVE' : 'DRAFT',
      components,
      parameters,
      changeReason: str(body.changeReason, 'reden voor wijziging', { required: true }),
    },
    user,
  );

  await record(
    user,
    'RECIPE_VERSION_CREATED',
    { type: 'RECIPE', id: params.id },
    `Versie v${version.version_no} van ${recipe.code} aangemaakt: ${body.changeReason}`,
    { versionId: version.id },
  );

  // Telling the producer straight away whether this will need a verifier is the
  // whole point of the change rules: it is a planning decision, not a surprise.
  const gate = await evaluateChange(version.id).catch(() => null);
  created(res, { version, gate });
});

router.post('/recipe-versions/:id/activate', async ({ res, user, params, body }) => {
  requireCap(user, 'recipes:write');
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [params.id]);
  if (!version) throw notFound('Receptuurversie niet gevonden.');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);
  ownsOrThrow(user, recipe.org_id);

  const activated = await activateRecipeVersion(params.id, str(body.effectiveFrom, 'geldig vanaf') ?? nowIso());
  await record(user, 'RECIPE_VERSION_ACTIVATED', { type: 'RECIPE', id: recipe.id }, `Versie v${version.version_no} van ${recipe.code} in productie genomen.`);
  ok(res, { version: activated });
});

/* ------------------------------------------------------------------ */
/* Version detail and calculation                                      */
/* ------------------------------------------------------------------ */

router.get('/recipe-versions/:id', async ({ res, user, params, query }) => {
  const { version, recipe } = await loadVersion(params.id, user);
  const scope = oneOf(query.scope, Object.values(SCOPES), 'scope') ?? 'A1-A3';

  const [components, parameters, result, declaration] = await Promise.all([
    componentsOf(params.id),
    parametersOf(params.id),
    calculateRecipeVersion(params.id, { scope, at: query.at ?? nowIso() }),
    get("SELECT * FROM declarations WHERE recipe_version_id = ? AND status <> 'REJECTED' ORDER BY created_at DESC LIMIT 1", [params.id]),
  ]);

  ok(res, {
    recipe,
    version,
    components,
    parameters,
    parameterDefs: PARAMETER_DEFS.filter((p) => p.module === 'A3'),
    result,
    declaration,
  });
});

router.get('/recipe-versions/:id/calculate', async ({ res, user, params, query }) => {
  await loadVersion(params.id, user);
  const result = await calculateRecipeVersion(params.id, {
    scope: oneOf(query.scope, Object.values(SCOPES), 'scope') ?? 'A1-A3',
    at: query.at ?? nowIso(),
    site: query.distanceKm ? { distanceKm: Number(query.distanceKm), transportProfileId: query.transportProfileId } : undefined,
    siteParameters: query.scope === 'A1-A5' ? await defaultParameters(['A5']) : undefined,
    volumeM3: query.volumeM3 ? Number(query.volumeM3) : undefined,
  });
  ok(res, { result });
});

/** Does this version need a verifier, and exactly why? */
router.get('/recipe-versions/:id/change-check', async ({ res, user, params }) => {
  await loadVersion(params.id, user);
  ok(res, { gate: await evaluateChange(params.id) });
});

/**
 * The transparency report - "op een knop duwen en het rolt eruit".
 * Every term, its inputs, its factor, the source of that factor and the
 * evidence behind it, in one document.
 */
router.get('/recipe-versions/:id/report', async ({ res, user, params, query }) => {
  await loadVersion(params.id, user);
  ok(res, { report: await buildReport({ recipeVersionId: params.id, scope: query.scope ?? 'A1-A3', at: query.at }) });
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function loadVersion(versionId, user) {
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [versionId]);
  if (!version) throw notFound('Receptuurversie niet gevonden.');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);
  if (recipe.org_id !== user.orgId && !isOversight(user)) throw new Forbidden('Deze receptuur hoort bij een andere producent.');
  return { version, recipe };
}

/**
 * Turn the client's component list into pinned material versions.
 *
 * Two rules are enforced here rather than trusted from the client: the producer
 * must actually have access to each material, and the pinned version is the one
 * that was in force on the recipe's effective date.
 */
async function resolveComponents(components, user, effectiveFrom) {
  if (!Array.isArray(components)) throw badRequest('Samenstelling ontbreekt.');
  const at = effectiveFrom ?? nowIso();
  const out = [];

  for (const [index, component] of components.entries()) {
    const materialId = str(component.materialId, 'grondstof', { required: true });
    const material = await get(
      'SELECT m.*, o.name AS supplier_name FROM materials m JOIN organisations o ON o.id = m.org_id WHERE m.id = ?',
      [materialId],
    );
    if (!material) throw notFound(`Grondstof ${materialId} bestaat niet.`);

    if (!(await canReadMaterialData(user, material))) {
      throw new Forbidden(
        `U hebt nog geen toegang tot de gegevens van ${material.name} (${material.supplier_name}). Vraag eerst toegang aan bij de leverancier.`,
      );
    }

    const materialVersion =
      (await materialVersionAt(materialId, at)) ??
      (await get('SELECT * FROM material_versions WHERE material_id = ? ORDER BY version_no DESC LIMIT 1', [materialId]));
    if (!materialVersion) {
      throw badRequest(`${material.name} heeft nog geen gepubliceerde milieugegevens en kan niet in een receptuur worden gebruikt.`);
    }

    out.push({
      materialId,
      materialVersionId: materialVersion.id,
      quantityKg: num(component.quantityKg, 'hoeveelheid', { required: true, min: 0, max: 5000 }),
      transportKm: num(component.transportKm, 'afstand', { min: 0, max: 20000 }) ?? 0,
      transportProfileId: str(component.transportProfileId, 'transportprofiel'),
      sort: index,
      note: str(component.note, 'nota'),
    });
  }
  return out;
}

function sanitiseParameters(parameters, modules) {
  const allowed = new Set(PARAMETER_DEFS.filter((p) => modules.includes(p.module)).map((p) => p.code));
  return parameters
    .filter((p) => allowed.has(p.code))
    .map((p) => {
      const overridden = bool(p.overridden);
      // An override without a written justification is refused at the door: it
      // is the single thing the external verifier is there to check.
      if (overridden && !str(p.justification, 'verantwoording')) {
        throw badRequest(
          `Parameter "${p.code}" wijkt af van de sectorwaarde. Geef een verantwoording op - de verificateur toetst hierop.`,
        );
      }
      return {
        code: p.code,
        value: num(p.value, p.code, { required: true, min: 0 }),
        unit: str(p.unit, 'eenheid') ?? '',
        source: overridden ? 'MEASURED' : 'SECTOR_DEFAULT',
        overridden,
        justification: str(p.justification, 'verantwoording'),
        attachmentUrl: str(p.attachmentUrl, 'bijlage', { max: 600 }),
      };
    });
}

export default router;
