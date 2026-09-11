/**
 * Seeding.
 *
 * Two layers:
 *   - master data (factors, rules, classes) is always brought up to date,
 *     because the calculation cannot run without it;
 *   - the demo dataset is only created when the database is still empty, so a
 *     real deployment that starts with DEMO_DATA=0 never gets fictional
 *     organisations in it.
 */
import { all, get, run, getSetting, setSetting } from './index.js';
import { id } from '../lib/ids.js';
import { hashPassword } from '../lib/auth.js';
import { DEFAULT_SETTINGS, PARAMETER_BY_CODE } from '../domain/constants.js';
import { createMaterialVersion, createRecipeVersion, activateRecipeVersion, nowIso } from '../domain/versioning.js';
import { submitDeclaration, takeIntoVerification, decideVerification, publishDeclaration } from '../domain/declarations.js';
import { TRANSPORT_PROFILES, ENERGY_FACTORS, PROCESS_DEFAULTS, CATEGORY_RULES, STRENGTH_CLASSES, VALID_FROM } from './seed-data/masterdata.js';
import * as demo from './seed-data/demo.js';

export async function seed({ withDemo = process.env.DEMO_DATA !== '0' } = {}) {
  await seedSettings();
  await seedMasterData();

  const existing = await get('SELECT id FROM organisations LIMIT 1');
  if (existing || !withDemo) return { seeded: false };

  await seedDemo();
  return { seeded: true };
}

/* ------------------------------------------------------------------ */
/* Settings and master data                                           */
/* ------------------------------------------------------------------ */

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if ((await getSetting(key)) === null) await setSetting(key, value);
  }
  if ((await getSetting('bypass_allow_new_material')) === null) await setSetting('bypass_allow_new_material', '0');
}

async function seedMasterData() {
  for (const profile of TRANSPORT_PROFILES) {
    const existing = await get('SELECT id FROM transport_profiles WHERE code = ? AND valid_from = ?', [profile.code, VALID_FROM]);
    if (existing) continue;
    const profileId = id('tp');
    await run(
      `INSERT INTO transport_profiles (id, code, name, mode, unit, payload_t, empty_return, source, valid_from, note)
       VALUES (?, ?, ?, ?, 'tkm', ?, ?, ?, ?, ?)`,
      [profileId, profile.code, profile.name, profile.mode, profile.payload_t ?? null, profile.empty_return ?? 1, profile.source, VALID_FROM, profile.note ?? null],
    );
    for (const [indicator, value] of Object.entries(profile.values)) {
      await run('INSERT INTO transport_profile_values (profile_id, indicator, value) VALUES (?, ?, ?)', [profileId, indicator, value]);
    }
  }

  for (const factor of ENERGY_FACTORS) {
    const existing = await get('SELECT id FROM energy_factors WHERE code = ? AND valid_from = ?', [factor.code, VALID_FROM]);
    if (existing) continue;
    const factorId = id('ef');
    await run('INSERT INTO energy_factors (id, code, name, unit, source, valid_from, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      factorId,
      factor.code,
      factor.name,
      factor.unit,
      factor.source,
      VALID_FROM,
      factor.note ?? null,
    ]);
    for (const [indicator, value] of Object.entries(factor.values)) {
      await run('INSERT INTO energy_factor_values (factor_id, indicator, value) VALUES (?, ?, ?)', [factorId, indicator, value]);
    }
  }

  for (const def of PROCESS_DEFAULTS) {
    const existing = await get('SELECT id FROM process_defaults WHERE code = ? AND valid_from = ?', [def.code, VALID_FROM]);
    if (existing) continue;
    await run('INSERT INTO process_defaults (id, code, value, unit, source, valid_from, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id('pd'),
      def.code,
      def.value,
      def.unit,
      def.source,
      VALID_FROM,
      def.note ?? null,
    ]);
  }

  for (const rule of CATEGORY_RULES) {
    const existing = await get('SELECT category FROM category_rules WHERE category = ?', [rule.category]);
    if (existing) continue;
    await run('INSERT INTO category_rules (category, required_modules, optional_modules, source, note) VALUES (?, ?, ?, ?, ?)', [
      rule.category,
      rule.required_modules,
      rule.optional_modules ?? '',
      rule.source,
      rule.note ?? null,
    ]);
  }

  for (const cls of STRENGTH_CLASSES) {
    const existing = await get('SELECT code FROM strength_classes WHERE code = ?', [cls.code]);
    if (existing) continue;
    await run('INSERT INTO strength_classes (code, family, fck_cyl, fck_cube, sort) VALUES (?, ?, ?, ?, ?)', [
      cls.code,
      cls.family,
      cls.fck_cyl,
      cls.fck_cube,
      cls.sort,
    ]);
  }
}

/** Current sector defaults as recipe/delivery parameter rows. */
export async function defaultParameters(modules = ['A3']) {
  const rows = await all('SELECT code, value, unit FROM process_defaults ORDER BY valid_from DESC');
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    const def = PARAMETER_BY_CODE[row.code];
    if (!def || !modules.includes(def.module)) continue;
    out.push({ code: row.code, value: row.value, unit: row.unit, source: 'SECTOR_DEFAULT', overridden: false });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Demo dataset                                                        */
/* ------------------------------------------------------------------ */

async function seedDemo() {
  const orgIds = {};
  const siteIds = {};
  const userByOrg = {};
  const materialIds = {};
  const materialVersionIds = {};
  const recipeIds = {};
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400_000).toISOString();

  /* --- organisations, sites, users --- */
  for (const org of demo.ORGANISATIONS) {
    const orgId = id('org');
    orgIds[org.key] = orgId;
    await run(
      'INSERT INTO organisations (id, name, type, vat, city, country, website, listed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      [orgId, org.name, org.type, org.vat ?? null, org.city ?? null, org.country ?? 'BE', null, daysAgo(400)],
    );

    for (const site of org.sites ?? []) {
      const siteId = id('site');
      siteIds[site.key] = siteId;
      await run('INSERT INTO sites (id, org_id, name, address, city, country, note, archived) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', [
        siteId,
        orgId,
        site.name,
        site.address ?? null,
        site.city ?? null,
        site.country ?? 'BE',
        site.note ?? null,
      ]);
    }

    for (const user of org.users ?? []) {
      const userId = id('usr');
      userByOrg[org.key] ??= userId;
      await run(
        'INSERT INTO users (id, org_id, email, name, role, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        [userId, orgId, user.email, user.name, user.role, hashPassword(demo.PASSWORD), daysAgo(400)],
      );
    }
  }

  const actorFor = async (orgKey) => {
    const row = await get('SELECT u.*, o.name AS org_name, o.type AS org_type FROM users u JOIN organisations o ON o.id = u.org_id WHERE u.id = ?', [
      userByOrg[orgKey],
    ]);
    return { id: row.id, name: row.name, email: row.email, role: row.role, orgId: row.org_id, orgName: row.org_name, orgType: row.org_type };
  };

  /* --- materials, evidence, first versions --- */
  for (const material of demo.MATERIALS) {
    const actor = await actorFor(material.org);
    const evidenceId = id('ev');
    const ev = material.evidence;
    await run(
      `INSERT INTO evidence (id, org_id, type, number, programme, issuer, valid_from, valid_until, document_url, scope_modules, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'A1,A2,A3', ?, ?, ?)`,
      [
        evidenceId,
        orgIds[material.org],
        ev.type,
        ev.number ?? null,
        ev.programme ?? null,
        ev.issuer ?? null,
        ev.valid_from ?? null,
        ev.valid_until ?? null,
        ev.number ? `https://bepd.belgium.be/declaration/${ev.number}` : null,
        ev.note ?? null,
        actor.id,
        daysAgo(300),
      ],
    );

    const materialId = id('mat');
    materialIds[material.key] = materialId;
    await run(
      'INSERT INTO materials (id, org_id, site_id, code, name, category, declared_unit, density, description, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      [
        materialId,
        orgIds[material.org],
        siteIds[material.site] ?? null,
        material.code,
        material.name,
        material.category,
        'TONNE',
        null,
        material.note ?? null,
        daysAgo(300),
      ],
    );

    const version = await createMaterialVersion(
      {
        materialId,
        effectiveFrom: daysAgo(300),
        evidenceId,
        includesInboundTransport: !!material.includesInboundTransport,
        changeReason: 'Initiële registratie.',
        values: demo.modules(material.values, material.family),
      },
      actor,
    );
    materialVersionIds[material.key] = version.id;
  }

  /* --- data sharing --- */
  for (const access of demo.ACCESS) {
    const requester = await actorFor(access.requester);
    const decided = access.status !== 'PENDING';
    await run(
      `INSERT INTO access_requests (id, requester_org_id, owner_org_id, material_id, status, reason, decided_by, decided_at, decision_note, created_by, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('acc'),
        orgIds[access.requester],
        orgIds[access.owner],
        access.status,
        access.reason,
        decided ? userByOrg[access.owner] : null,
        decided ? daysAgo(250) : null,
        decided ? 'Klantrelatie bevestigd.' : null,
        requester.id,
        daysAgo(260),
      ],
    );
  }

  /* --- recipes --- */
  const plantParameters = await defaultParameters(['A3']);

  for (const recipe of demo.RECIPES) {
    const actor = await actorFor(recipe.org);
    const recipeId = id('rec');
    recipeIds[recipe.key] = recipeId;

    await run(
      `INSERT INTO recipes (id, org_id, site_id, code, name, strength_class, exposure_classes, consistency, dmax, density, benor, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        recipeId,
        orgIds[recipe.org],
        siteIds[recipe.site] ?? null,
        recipe.code,
        recipe.name,
        recipe.strength_class,
        recipe.exposure_classes,
        recipe.consistency,
        recipe.dmax,
        recipe.density,
        recipe.benor ? 1 : 0,
        daysAgo(180),
      ],
    );

    const components = await Promise.all(
      recipe.components.map(async (c, i) => ({
        materialId: materialIds[c.material],
        materialVersionId: materialVersionIds[c.material],
        quantityKg: c.quantityKg,
        transportKm: c.transportKm,
        transportProfileId: c.profile ? await profileIdFor(c.profile) : null,
        sort: i,
      })),
    );

    // De Schelde measures its own plant consumption and can prove it, so the
    // sector default is overridden with a justification - exactly the case the
    // external verifier exists to audit.
    const parameters = plantParameters.map((p) =>
      recipe.org === 'schelde' && p.code === 'PLANT_ELECTRICITY'
        ? {
            ...p,
            value: 1.9,
            source: 'MEASURED',
            overridden: true,
            justification:
              'Gemeten verbruik menginstallatie 2025 (12 maanden, tussenteller M-04). Meetrapport EnergieAudit BV, ref. EA-2025-0912.',
          }
        : p,
    );

    const v1 = await createRecipeVersion(
      { recipeId, effectiveFrom: daysAgo(160), status: 'ACTIVE', components, parameters, changeReason: 'Initiële receptuur.' },
      actor,
    );

    await runLifecycle(recipe, v1, actor, { recipeId, materialIds, materialVersionIds, daysAgo });
  }

  /* --- projects and deliveries --- */
  for (const project of demo.PROJECTS) {
    const actor = await actorFor(project.org);
    const projectId = id('prj');
    await run(
      'INSERT INTO projects (id, org_id, name, reference, address, city, architect, note, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)',
      [projectId, orgIds[project.org], project.name, project.reference, project.address, project.city, project.architect, daysAgo(60)],
    );

    for (const [module, orgKey] of Object.entries(project.responsibilities)) {
      await run('INSERT INTO project_responsibilities (project_id, module, org_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)', [
        projectId,
        module,
        orgIds[orgKey],
        actor.id,
        daysAgo(60),
      ]);
    }

    const siteParameters = await defaultParameters(['A5']);

    for (const delivery of project.deliveries) {
      const version = await get(
        "SELECT * FROM recipe_versions WHERE recipe_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1",
        [recipeIds[delivery.recipe]],
      );
      const recipeRow = await get('SELECT * FROM recipes WHERE id = ?', [recipeIds[delivery.recipe]]);
      const deliveryId = id('dlv');

      await run(
        `INSERT INTO deliveries (id, project_id, recipe_version_id, producer_org_id, contractor_org_id, delivery_note,
                                 volume_m3, delivered_at, distance_km, transport_profile_id, status, result_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', NULL, ?, ?)`,
        [
          deliveryId,
          projectId,
          version.id,
          recipeRow.org_id,
          orgIds[project.org],
          delivery.note,
          delivery.volumeM3,
          daysAgo(delivery.daysAgo),
          delivery.distanceKm,
          await profileIdFor(delivery.profile),
          actor.id,
          daysAgo(delivery.daysAgo),
        ],
      );

      for (const p of siteParameters) {
        await run(
          'INSERT INTO delivery_parameters (id, delivery_id, code, value, unit, source, overridden, justification, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
          [id('dp'), deliveryId, p.code, p.value, p.unit, p.source, actor.id, daysAgo(delivery.daysAgo)],
        );
      }
    }
  }

  /* --- een lopende melding van een leverancier --- */
  // Het scenario dat vandaag misloopt: een cementleverancier past een parameter
  // aan en publiceert dat ergens op een website. Hier komt het bij elke afnemer
  // binnen die het product gebruikt.
  const cement = await get("SELECT m.*, o.name AS supplier_name FROM materials m JOIN organisations o ON o.id = m.org_id WHERE m.code = 'CEM III/A 42,5 N LA'");
  const { notify } = await import('../lib/audit.js');
  await notify(
    orgIds.schelde,
    'MATERIAL_CHANGED',
    'Leverancier wijzigde een parameter',
    `${cement?.supplier_name} — ${cement?.code}: GWP A1–A3 aangepast naar aanleiding van een nieuwe ovenlijn. Controleer welke recepturen hierdoor buiten de bandbreedte vallen.`,
    '#/materials',
  );
}

/**
 * Walk a demo recipe through the lifecycle its scenario calls for. The
 * PUBLISHED_WITH_HISTORY case is the interesting one: it produces a verified
 * dossier, a small follow-up change that inherits that verification, and a
 * larger change that is pushed back to the verifier.
 */
async function runLifecycle(recipe, v1, actor, ctx) {
  const { daysAgo } = ctx;
  const verifier = await get("SELECT id FROM organisations WHERE type = 'VERIFIER' LIMIT 1");
  const verifierUser = await get(
    "SELECT u.*, o.name AS org_name, o.type AS org_type FROM users u JOIN organisations o ON o.id = u.org_id WHERE o.type = 'VERIFIER' LIMIT 1",
  );
  const verifierActor = verifierUser
    ? { id: verifierUser.id, name: verifierUser.name, role: verifierUser.role, orgId: verifierUser.org_id, orgName: verifierUser.org_name, orgType: verifierUser.org_type }
    : null;

  if (recipe.lifecycle === 'DRAFT') return;

  if (recipe.lifecycle === 'SUBMITTED') {
    const { declaration } = await submitDeclaration({ recipeVersionId: v1.id, verifierOrgId: verifier.id }, actor);
    await backdate(declaration.id, daysAgo(12));
    await takeIntoVerification(declaration.id, verifierActor);
    return;
  }

  // PUBLISHED and PUBLISHED_WITH_HISTORY both start with a full verification.
  const first = await submitDeclaration({ recipeVersionId: v1.id, verifierOrgId: verifier.id }, actor);
  await backdate(first.declaration.id, daysAgo(150));
  await takeIntoVerification(first.declaration.id, verifierActor);
  await decideVerification(first.declaration.id, { approve: true, note: 'Steekproef op leveringsbonnen en energiemeting uitgevoerd. Rekenregels conform EN 15804+A2.' }, verifierActor);
  await publishDeclaration(first.declaration.id, verifierActor);
  await backdate(first.declaration.id, daysAgo(150));

  if (recipe.lifecycle !== 'PUBLISHED_WITH_HISTORY') return;

  /* v2: a small optimisation that should slip through the bypass. */
  const components2 = (await ctxComponents(v1.id)).map((c) =>
    c.materialId === ctx.materialIds.cem3 ? { ...c, quantityKg: 312 } : c,
  );
  const v2 = await createRecipeVersion(
    {
      recipeId: ctx.recipeId,
      effectiveFrom: daysAgo(40),
      status: 'ACTIVE',
      components: components2,
      changeReason: 'Cementdosering met 8 kg verlaagd na optimalisatie van de korrelopbouw.',
    },
    actor,
  );
  const second = await submitDeclaration({ recipeVersionId: v2.id, verifierOrgId: verifier.id }, actor);
  await backdate(second.declaration.id, daysAgo(40));

  /* v3: a change big enough that the gate sends it back to the verifier. */
  const components3 = (await ctxComponents(v2.id)).map((c) =>
    c.materialId === ctx.materialIds.cem3 ? { ...c, quantityKg: 272 } : c,
  );
  const v3 = await createRecipeVersion(
    {
      recipeId: ctx.recipeId,
      effectiveFrom: nowIso(),
      status: 'DRAFT',
      components: components3,
      changeReason: 'Verdere verlaging van de cementdosering, in afwachting van proefresultaten op 28 dagen.',
    },
    actor,
  );
  await submitDeclaration({ recipeVersionId: v3.id, verifierOrgId: verifier.id }, actor);
}

async function ctxComponents(versionId) {
  const rows = await all('SELECT * FROM recipe_components WHERE recipe_version_id = ? ORDER BY sort', [versionId]);
  return rows.map((c) => ({
    materialId: c.material_id,
    materialVersionId: c.material_version_id,
    quantityKg: c.quantity_kg,
    transportKm: c.transport_km,
    transportProfileId: c.transport_profile_id,
    sort: c.sort,
  }));
}

/**
 * Demo timestamps have to be spread over the past year, and the ordering
 * between declarations is what the change-control lookups rely on.
 */
async function backdate(declarationId, isoDate) {
  const current = await get('SELECT submitted_at, verified_at FROM declarations WHERE id = ?', [declarationId]);
  await run('UPDATE declarations SET created_at = ?, submitted_at = ?, verified_at = ? WHERE id = ?', [
    isoDate,
    current?.submitted_at ? isoDate : null,
    current?.verified_at ? isoDate : null,
    declarationId,
  ]);
}

async function profileIdFor(code) {
  const row = await get('SELECT id FROM transport_profiles WHERE code = ? ORDER BY valid_from DESC LIMIT 1', [code]);
  return row?.id ?? null;
}
