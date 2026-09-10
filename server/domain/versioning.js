/**
 * Effective-dated versioning.
 *
 * Recipes change from one day to the next - 10 kg less cement here, a different
 * sand supplier there. A verification that happens in November must still be
 * able to reconstruct the recipe exactly as it stood during an August delivery,
 * so nothing is ever edited in place. A change closes the running version and
 * opens a new one.
 */
import { all, get, run, tx } from '../db/index.js';
import { id } from '../lib/ids.js';
import { VERSION_STATUS } from './constants.js';

export const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/** The material version that was in force at `at` (default: now). */
export async function materialVersionAt(materialId, at = nowIso()) {
  return get(
    `SELECT * FROM material_versions
      WHERE material_id = ?
        AND status <> 'DRAFT'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY effective_from DESC, version_no DESC
      LIMIT 1`,
    [materialId, at, at],
  );
}

/** The most recent material version, draft included. */
export async function currentMaterialVersion(materialId) {
  return get('SELECT * FROM material_versions WHERE material_id = ? ORDER BY version_no DESC LIMIT 1', [materialId]);
}

export async function materialVersions(materialId) {
  return all('SELECT * FROM material_versions WHERE material_id = ? ORDER BY version_no DESC', [materialId]);
}

export async function recipeVersionAt(recipeId, at = nowIso()) {
  return get(
    `SELECT * FROM recipe_versions
      WHERE recipe_id = ?
        AND status <> 'DRAFT'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY effective_from DESC, version_no DESC
      LIMIT 1`,
    [recipeId, at, at],
  );
}

export async function currentRecipeVersion(recipeId) {
  return get('SELECT * FROM recipe_versions WHERE recipe_id = ? ORDER BY version_no DESC LIMIT 1', [recipeId]);
}

export async function activeRecipeVersion(recipeId) {
  return get(
    "SELECT * FROM recipe_versions WHERE recipe_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1",
    [recipeId],
  );
}

export async function recipeVersions(recipeId) {
  return all('SELECT * FROM recipe_versions WHERE recipe_id = ? ORDER BY version_no DESC', [recipeId]);
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/**
 * Open a new material version, closing whatever was running.
 *
 * @param {object} input
 * @param {string} input.materialId
 * @param {string} [input.effectiveFrom]
 * @param {string} [input.evidenceId]
 * @param {boolean} [input.includesInboundTransport]
 * @param {string} [input.changeReason]
 * @param {object} input.values  { [module]: { [indicator]: number } }
 * @param {object} actor
 */
export async function createMaterialVersion(input, actor) {
  const effectiveFrom = input.effectiveFrom ?? nowIso();
  return tx(async () => {
    const previous = await currentMaterialVersion(input.materialId);
    const versionNo = (previous?.version_no ?? 0) + 1;

    if (previous && previous.effective_to === null) {
      await run('UPDATE material_versions SET effective_to = ?, status = ? WHERE id = ?', [
        effectiveFrom,
        VERSION_STATUS.SUPERSEDED,
        previous.id,
      ]);
    }

    const versionId = id('mv');
    await run(
      `INSERT INTO material_versions
        (id, material_id, version_no, status, effective_from, effective_to, evidence_id,
         includes_inbound_transport, change_reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        versionId,
        input.materialId,
        versionNo,
        input.status ?? VERSION_STATUS.ACTIVE,
        effectiveFrom,
        input.evidenceId ?? null,
        input.includesInboundTransport ? 1 : 0,
        input.changeReason ?? null,
        actor?.id ?? null,
        nowIso(),
      ],
    );

    await writeMaterialValues(versionId, input.values ?? {});
    return get('SELECT * FROM material_versions WHERE id = ?', [versionId]);
  });
}

export async function writeMaterialValues(versionId, values) {
  await run('DELETE FROM material_version_values WHERE version_id = ?', [versionId]);
  for (const [module, byIndicator] of Object.entries(values)) {
    for (const [indicator, raw] of Object.entries(byIndicator ?? {})) {
      if (raw === null || raw === undefined || raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      await run('INSERT INTO material_version_values (version_id, module, indicator, value) VALUES (?, ?, ?, ?)', [
        versionId,
        module,
        indicator,
        num,
      ]);
    }
  }
}

/** { [module]: { [indicator]: number } } for one material version. */
export async function materialValues(versionId) {
  const rows = await all('SELECT module, indicator, value FROM material_version_values WHERE version_id = ?', [versionId]);
  const out = {};
  for (const r of rows) {
    (out[r.module] ??= {})[r.indicator] = r.value;
  }
  return out;
}

export async function declaredModules(versionId) {
  const rows = await all('SELECT DISTINCT module FROM material_version_values WHERE version_id = ? ORDER BY module', [
    versionId,
  ]);
  return rows.map((r) => r.module);
}

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Open a new recipe version. Components and parameters are copied from the
 * parent unless the caller supplies replacements, so "10 kg cement minder" is a
 * one-field change rather than a full re-entry.
 */
export async function createRecipeVersion(input, actor) {
  const effectiveFrom = input.effectiveFrom ?? nowIso();
  return tx(async () => {
    const previous = await currentRecipeVersion(input.recipeId);
    const versionNo = (previous?.version_no ?? 0) + 1;
    const status = input.status ?? VERSION_STATUS.DRAFT;

    // Only an activated version closes the running one; drafts sit beside it.
    if (previous && previous.effective_to === null && status === VERSION_STATUS.ACTIVE) {
      await run('UPDATE recipe_versions SET effective_to = ?, status = ? WHERE id = ?', [
        effectiveFrom,
        VERSION_STATUS.SUPERSEDED,
        previous.id,
      ]);
    }

    const versionId = id('rv');
    await run(
      `INSERT INTO recipe_versions
        (id, recipe_id, version_no, status, effective_from, effective_to, parent_version_id, change_reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        versionId,
        input.recipeId,
        versionNo,
        status,
        effectiveFrom,
        previous?.id ?? null,
        input.changeReason ?? null,
        actor?.id ?? null,
        nowIso(),
      ],
    );

    const components = input.components ?? (previous ? await copyComponents(previous.id) : []);
    await writeComponents(versionId, components);

    const parameters = input.parameters ?? (previous ? await copyParameters(previous.id) : []);
    await writeParameters(versionId, parameters);

    return get('SELECT * FROM recipe_versions WHERE id = ?', [versionId]);
  });
}

/** Activate a draft version: it closes the running one from `effectiveFrom`. */
export async function activateRecipeVersion(versionId, effectiveFrom = nowIso()) {
  return tx(async () => {
    const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [versionId]);
    if (!version) throw new Error('recipe version not found');

    const running = await get(
      "SELECT * FROM recipe_versions WHERE recipe_id = ? AND id <> ? AND status = 'ACTIVE' AND effective_to IS NULL",
      [version.recipe_id, versionId],
    );
    if (running) {
      await run('UPDATE recipe_versions SET effective_to = ?, status = ? WHERE id = ?', [
        effectiveFrom,
        VERSION_STATUS.SUPERSEDED,
        running.id,
      ]);
    }
    await run('UPDATE recipe_versions SET status = ?, effective_from = ? WHERE id = ?', [
      VERSION_STATUS.ACTIVE,
      effectiveFrom,
      versionId,
    ]);
    return get('SELECT * FROM recipe_versions WHERE id = ?', [versionId]);
  });
}

export async function copyComponents(versionId) {
  const rows = await all('SELECT * FROM recipe_components WHERE recipe_version_id = ? ORDER BY sort', [versionId]);
  return rows.map((c) => ({
    materialId: c.material_id,
    materialVersionId: c.material_version_id,
    quantityKg: c.quantity_kg,
    transportKm: c.transport_km,
    transportProfileId: c.transport_profile_id,
    sort: c.sort,
    note: c.note,
  }));
}

export async function writeComponents(versionId, components) {
  await run('DELETE FROM recipe_components WHERE recipe_version_id = ?', [versionId]);
  let i = 0;
  for (const c of components) {
    await run(
      `INSERT INTO recipe_components
        (id, recipe_version_id, material_id, material_version_id, quantity_kg, transport_km, transport_profile_id, sort, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('rc'),
        versionId,
        c.materialId,
        c.materialVersionId,
        Number(c.quantityKg) || 0,
        Number(c.transportKm) || 0,
        c.transportProfileId ?? null,
        c.sort ?? i,
        c.note ?? null,
      ],
    );
    i += 1;
  }
}

export async function copyParameters(versionId) {
  const rows = await all('SELECT * FROM recipe_parameters WHERE recipe_version_id = ?', [versionId]);
  return rows.map((p) => ({
    code: p.code,
    value: p.value,
    unit: p.unit,
    source: p.source,
    overridden: !!p.overridden,
    justification: p.justification,
    attachmentUrl: p.attachment_url,
  }));
}

export async function writeParameters(versionId, parameters) {
  await run('DELETE FROM recipe_parameters WHERE recipe_version_id = ?', [versionId]);
  for (const p of parameters) {
    await run(
      `INSERT INTO recipe_parameters
        (id, recipe_version_id, code, value, unit, source, overridden, justification, attachment_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('rp'),
        versionId,
        p.code,
        Number(p.value) || 0,
        p.unit ?? '',
        p.source ?? 'SECTOR_DEFAULT',
        p.overridden ? 1 : 0,
        p.justification ?? null,
        p.attachmentUrl ?? null,
      ],
    );
  }
}

export async function componentsOf(versionId) {
  return all(
    `SELECT rc.*, m.name AS material_name, m.category, m.code AS material_code,
            m.declared_unit, m.density AS material_density, m.org_id AS supplier_org_id,
            o.name AS supplier_name
       FROM recipe_components rc
       JOIN materials m ON m.id = rc.material_id
       JOIN organisations o ON o.id = m.org_id
      WHERE rc.recipe_version_id = ?
      ORDER BY rc.sort`,
    [versionId],
  );
}

export async function parametersOf(versionId) {
  return all('SELECT * FROM recipe_parameters WHERE recipe_version_id = ?', [versionId]);
}
