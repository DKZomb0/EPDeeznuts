/**
 * Change control - the "bypass" rules.
 *
 * A concrete plant tweaks recipes constantly: 10 kg less cement, a slightly
 * different sand. Sending every one of those through a EUR 2 000 external
 * verification is what makes the whole regime unworkable, so small changes
 * inherit the previous verification instead.
 *
 * The obvious hole in that idea is salami slicing: twenty consecutive 2,5 %
 * changes are a 50 % change that never met a verifier. Three guards close it:
 *
 *   1. per-change tolerance   - one step may not move GWP by more than X %
 *   2. cumulative drift       - total movement since the last *full*
 *                               verification may not exceed Y %
 *   3. consecutive bypasses   - after N inherited versions, one full
 *                               verification is forced regardless of size
 *
 * Every threshold is a setting rather than a constant, because the numbers are
 * exactly what is still being negotiated at Flemish level. The rules also never
 * apply to a dossier that is not fully BEPD-backed: a result carrying an
 * international EPD or a sector average always goes to a verifier.
 */
import { all, get, getSettingNumber, getSetting } from '../db/index.js';
import { LEAD_INDICATOR } from './constants.js';
import { calculateRecipeVersion } from './calc.js';
import { componentsOf, nowIso } from './versioning.js';

export const BYPASS_DECISION = {
  AUTO_ACCEPT: 'AUTO_ACCEPT',
  REQUIRES_VERIFICATION: 'REQUIRES_VERIFICATION',
};

/**
 * Decide whether a new recipe version may inherit the verification of the one
 * before it.
 *
 * @param {string} recipeVersionId  the *new* version
 * @param {object} [options] { at, result } - pass `result` to reuse a
 *        calculation you already have instead of running it twice
 * @returns {Promise<object>} decision with a full, quotable rationale
 */
export async function evaluateChange(recipeVersionId, options = {}) {
  const at = options.at ?? nowIso();
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [recipeVersionId]);
  if (!version) throw new Error(`recipe version ${recipeVersionId} not found`);

  const thresholds = {
    tolerancePct: await getSettingNumber('bypass_tolerance_pct', 3),
    cumulativePct: await getSettingNumber('bypass_cumulative_pct', 7.5),
    maxConsecutive: await getSettingNumber('bypass_max_consecutive', 5),
    allowNewMaterial: (await getSetting('bypass_allow_new_material', '0')) === '1',
  };

  const result = options.result ?? (await calculateRecipeVersion(recipeVersionId, { at, scope: 'A1-A3' }));
  const newValue = result.totals[LEAD_INDICATOR];

  // The declaration currently in force for this recipe, and the last one that
  // actually passed a verifier (the anchor the cumulative drift is measured
  // against).
  const effective = await latestDeclaration(version.recipe_id, ['VERIFIED', 'PUBLISHED', 'AUTO_ACCEPTED'], recipeVersionId);
  const anchor = await latestFullVerification(version.recipe_id, recipeVersionId);

  const checks = [];
  const push = (code, passed, message, detail = null) => checks.push({ code, passed, message, detail });

  if (!effective) {
    push('NO_PREVIOUS_DECLARATION', false, 'Er bestaat nog geen geverifieerde declaratie voor deze receptuur. De eerste versie gaat altijd door de externe verificatie.');
    return decide({ recipeVersionId, checks, thresholds, newValue, result, at, effective, anchor });
  }

  const previousValue = valueOf(effective, LEAD_INDICATOR);
  const anchorValue = anchor ? valueOf(anchor, LEAD_INDICATOR) : previousValue;

  const deviationPct = pctChange(previousValue, newValue);
  const cumulativePct = pctChange(anchorValue, newValue);
  const consecutive = await countConsecutiveBypasses(version.recipe_id, anchor?.id ?? null, recipeVersionId);

  /* --- 0. the dossier itself must be clean --------------------------- */
  if (result.verdict === 'VALID') {
    push('VERDICT_CLEAN', true, 'Alle grondstoffen zijn BEPD-gedekt en geldig op de referentiedatum.');
  } else {
    push(
      'VERDICT_CLEAN',
      false,
      `Het rekenresultaat is "${result.verdict}". Een dossier dat niet volledig BEPD-gedekt is, komt nooit in aanmerking voor de bypass.`,
      { verdict: result.verdict },
    );
  }

  /* --- 1. per-change tolerance --------------------------------------- */
  push(
    'SINGLE_STEP',
    Math.abs(deviationPct) <= thresholds.tolerancePct,
    `Wijziging t.o.v. de vorige declaratie: ${signed(deviationPct)} % (drempel ± ${thresholds.tolerancePct} %).`,
    { deviationPct, thresholdPct: thresholds.tolerancePct, previousValue, newValue },
  );

  /* --- 2. cumulative drift ------------------------------------------- */
  push(
    'CUMULATIVE_DRIFT',
    Math.abs(cumulativePct) <= thresholds.cumulativePct,
    `Totale afwijking sinds de laatste volledige verificatie: ${signed(cumulativePct)} % (drempel ± ${thresholds.cumulativePct} %).`,
    { cumulativePct, thresholdPct: thresholds.cumulativePct, anchorValue, newValue, anchorId: anchor?.id ?? null },
  );

  /* --- 3. consecutive bypasses --------------------------------------- */
  push(
    'CONSECUTIVE_BYPASSES',
    consecutive < thresholds.maxConsecutive,
    `${consecutive} van maximaal ${thresholds.maxConsecutive} opeenvolgende automatische aanvaardingen gebruikt.`,
    { consecutive, max: thresholds.maxConsecutive },
  );

  /* --- 4. composition changes ---------------------------------------- */
  const introduced = await newMaterials(recipeVersionId, effective.recipe_version_id);
  if (introduced.length && !thresholds.allowNewMaterial) {
    push(
      'NO_NEW_MATERIAL',
      false,
      `Nieuwe grondstof(fen) in de receptuur: ${introduced.map((m) => m.material_name).join(', ')}. Een gewijzigde samenstelling gaat altijd door de verificatie, ook bij een kleine impact.`,
      { materials: introduced.map((m) => ({ id: m.material_id, name: m.material_name })) },
    );
  } else if (introduced.length) {
    push('NO_NEW_MATERIAL', true, `Nieuwe grondstof(fen) toegelaten door de sectorinstelling: ${introduced.map((m) => m.material_name).join(', ')}.`);
  } else {
    push('NO_NEW_MATERIAL', true, 'De samenstelling gebruikt dezelfde grondstoffen als de vorige declaratie.');
  }

  return decide({
    recipeVersionId,
    checks,
    thresholds,
    newValue,
    previousValue,
    anchorValue,
    deviationPct,
    cumulativePct,
    consecutive,
    result,
    at,
    effective,
    anchor,
  });
}

function decide(ctx) {
  const failed = ctx.checks.filter((c) => !c.passed);
  const decision = failed.length ? BYPASS_DECISION.REQUIRES_VERIFICATION : BYPASS_DECISION.AUTO_ACCEPT;

  return {
    decision,
    recipeVersionId: ctx.recipeVersionId,
    referenceDate: ctx.at,
    indicator: LEAD_INDICATOR,
    newValue: ctx.newValue ?? null,
    previousValue: ctx.previousValue ?? null,
    anchorValue: ctx.anchorValue ?? null,
    deviationPct: ctx.deviationPct ?? null,
    cumulativePct: ctx.cumulativePct ?? null,
    consecutiveBypasses: ctx.consecutive ?? 0,
    thresholds: ctx.thresholds,
    checks: ctx.checks,
    blockedBy: failed.map((c) => c.code),
    previousDeclarationId: ctx.effective?.id ?? null,
    anchorDeclarationId: ctx.anchor?.id ?? null,
    verdict: ctx.result?.verdict ?? null,
    summary:
      decision === BYPASS_DECISION.AUTO_ACCEPT
        ? 'De wijziging blijft binnen alle afgesproken grenzen. De vorige verificatie blijft gelden; er is geen nieuwe externe controle nodig.'
        : `Externe verificatie vereist: ${failed.map((c) => c.message).join(' ')}`,
  };
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Optional filters are assembled in JavaScript rather than with
 * `(? IS NULL OR ...)`: Postgres cannot infer a type for a bare parameter in a
 * null test, and this code has to run on both dialects.
 */
async function latestDeclaration(recipeId, statuses, excludeVersionId = null) {
  const placeholders = statuses.map(() => '?').join(',');
  const params = [recipeId, ...statuses];
  let exclusion = '';
  if (excludeVersionId) {
    exclusion = 'AND d.recipe_version_id <> ?';
    params.push(excludeVersionId);
  }
  return get(
    `SELECT d.* FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
      WHERE rv.recipe_id = ?
        AND d.status IN (${placeholders})
        ${exclusion}
      ORDER BY d.created_at DESC
      LIMIT 1`,
    params,
  );
}

/** The last declaration that actually went through a verifier. */
async function latestFullVerification(recipeId, excludeVersionId = null) {
  const params = [recipeId];
  let exclusion = '';
  if (excludeVersionId) {
    exclusion = 'AND d.recipe_version_id <> ?';
    params.push(excludeVersionId);
  }
  return get(
    `SELECT d.* FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
      WHERE rv.recipe_id = ?
        AND d.status IN ('VERIFIED', 'PUBLISHED')
        AND d.bypass_of IS NULL
        ${exclusion}
      ORDER BY d.created_at DESC
      LIMIT 1`,
    params,
  );
}

async function countConsecutiveBypasses(recipeId, anchorId, excludeVersionId) {
  const anchor = anchorId ? await get('SELECT created_at FROM declarations WHERE id = ?', [anchorId]) : null;
  const params = [recipeId];
  const clauses = [];
  if (anchor?.created_at) {
    clauses.push('AND d.created_at > ?');
    params.push(anchor.created_at);
  }
  if (excludeVersionId) {
    clauses.push('AND d.recipe_version_id <> ?');
    params.push(excludeVersionId);
  }
  const rows = await all(
    `SELECT d.id FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
      WHERE rv.recipe_id = ?
        AND d.status = 'AUTO_ACCEPTED'
        ${clauses.join(' ')}`,
    params,
  );
  return rows.length;
}

/** Materials present in the new version that the previous one did not use. */
async function newMaterials(newVersionId, previousVersionId) {
  if (!previousVersionId) return [];
  const next = await componentsOf(newVersionId);
  const prev = await componentsOf(previousVersionId);
  const known = new Set(prev.map((c) => c.material_id));
  return next.filter((c) => !known.has(c.material_id));
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function valueOf(declaration, indicator) {
  if (!declaration?.result_json) return null;
  try {
    const parsed = JSON.parse(declaration.result_json);
    return parsed?.totals?.[indicator] ?? null;
  } catch {
    return null;
  }
}

export function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function signed(n) {
  if (!Number.isFinite(n)) return '0,0';
  return `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}`;
}
