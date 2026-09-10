/**
 * The declaration lifecycle.
 *
 *   DRAFT -> SUBMITTED -> UNDER_VERIFICATION -> VERIFIED -> PUBLISHED
 *                      \-> AUTO_ACCEPTED (change control let it inherit)
 *                      \-> REJECTED
 *
 * Two things happen at submission and both are recorded permanently:
 *
 *   1. The calculation is snapshotted into `result_json`. What a verifier signs
 *      off on must never move afterwards because a transport factor was
 *      updated in master data. Re-running the engine later gives today's
 *      answer; the dossier keeps the answer that was actually verified.
 *
 *   2. The change-control rules run, and their full rationale is written to
 *      `gate_checks`. Whether a version skipped verification, and exactly why,
 *      is the first thing anyone will ask in an audit.
 */
import { all, get, getSettingNumber, run, tx } from '../db/index.js';
import { id } from '../lib/ids.js';
import { record, notify } from '../lib/audit.js';
import { calculateRecipeVersion } from './calc.js';
import { evaluateChange, BYPASS_DECISION } from './changes.js';
import { approvable } from './validity.js';
import { DECLARATION_STATUS, GATE_DECISIONS } from './constants.js';
import { nowIso } from './versioning.js';

/**
 * Submit a recipe version for declaration.
 *
 * Returns { declaration, result, gate } - `gate` explains, check by check, why
 * the version did or did not need to go to a verifier.
 */
export async function submitDeclaration({ recipeVersionId, scope = 'A1-A3', verifierOrgId = null, at = null }, actor) {
  const referenceDate = at ?? nowIso();
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [recipeVersionId]);
  if (!version) throw notFound('Receptuurversie niet gevonden.');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);

  const existing = await get(
    "SELECT * FROM declarations WHERE recipe_version_id = ? AND status NOT IN ('REJECTED','EXPIRED')",
    [recipeVersionId],
  );
  if (existing) {
    const err = new Error('Voor deze receptuurversie bestaat al een lopende declaratie.');
    err.status = 409;
    throw err;
  }

  const result = await calculateRecipeVersion(recipeVersionId, { at: referenceDate, scope });
  const gate = await evaluateChange(recipeVersionId, { at: referenceDate, result });

  const autoAccepted = gate.decision === BYPASS_DECISION.AUTO_ACCEPT;
  const validityMonths = await getSettingNumber('declaration_validity_months', 60);

  return tx(async () => {
    const declarationId = id('dec');
    const now = nowIso();

    // An inherited verification keeps the certificate of the dossier it
    // inherits from: it is the same verified claim, revised within tolerance.
    const inherited = autoAccepted && gate.previousDeclarationId
      ? await get('SELECT * FROM declarations WHERE id = ?', [gate.previousDeclarationId])
      : null;

    await run(
      `INSERT INTO declarations
        (id, org_id, recipe_version_id, scope, status, verdict, verifier_org_id, certificate_no,
         result_json, submitted_at, submitted_by, verified_at, verified_by, valid_until,
         bypass_of, bypass_deviation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        declarationId,
        recipe.org_id,
        recipeVersionId,
        scope,
        autoAccepted ? DECLARATION_STATUS.AUTO_ACCEPTED : DECLARATION_STATUS.SUBMITTED,
        result.verdict,
        verifierOrgId ?? inherited?.verifier_org_id ?? null,
        inherited?.certificate_no ?? null,
        JSON.stringify(result),
        now,
        actor?.id ?? null,
        autoAccepted ? now : null,
        null,
        autoAccepted ? inherited?.valid_until ?? addMonths(now, validityMonths) : null,
        autoAccepted ? gate.previousDeclarationId : null,
        autoAccepted ? gate.deviationPct : null,
        now,
      ],
    );

    await writeGateCheck({
      subjectType: 'RECIPE_VERSION',
      subjectId: recipeVersionId,
      decision: autoAccepted ? GATE_DECISIONS.GO : GATE_DECISIONS.GO_WITH_WARNING,
      verdict: result.verdict,
      deviationPct: gate.deviationPct,
      thresholdPct: gate.thresholds.tolerancePct,
      reasons: gate.checks,
      actor,
      note: gate.summary,
    });

    await record(
      actor,
      autoAccepted ? 'DECLARATION_AUTO_ACCEPTED' : 'DECLARATION_SUBMITTED',
      { type: 'DECLARATION', id: declarationId },
      autoAccepted
        ? `Receptuur ${recipe.code} v${version.version_no} automatisch aanvaard binnen de wijzigingsmarge (${fmtPct(gate.deviationPct)}).`
        : `Receptuur ${recipe.code} v${version.version_no} ingediend voor externe verificatie.`,
      { gate, verdict: result.verdict, lead: result.lead.total },
    );

    if (autoAccepted) {
      await notify(
        recipe.org_id,
        'BYPASS',
        `Wijziging automatisch aanvaard: ${recipe.code}`,
        `De afwijking van ${fmtPct(gate.deviationPct)} blijft binnen de marge van ${gate.thresholds.tolerancePct} %. De bestaande verificatie blijft gelden.`,
        `#/declarations/${declarationId}`,
      );
    } else {
      await notify(
        recipe.org_id,
        'SUBMITTED',
        `Verificatie aangevraagd: ${recipe.code}`,
        gate.summary,
        `#/declarations/${declarationId}`,
      );
      if (verifierOrgId) {
        await notify(
          verifierOrgId,
          'VERIFICATION_REQUEST',
          `Nieuw dossier ter verificatie: ${recipe.code}`,
          `${result.subject.strengthClass ?? ''} — ingediend door de betonproducent.`,
          `#/verification/${declarationId}`,
        );
      }
    }

    const declaration = await get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
    return { declaration, result, gate };
  });
}

/** A verifier picks the dossier up. */
export async function takeIntoVerification(declarationId, actor) {
  const declaration = await get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
  if (!declaration) throw notFound('Declaratie niet gevonden.');

  await run('UPDATE declarations SET status = ?, verifier_org_id = ? WHERE id = ?', [
    DECLARATION_STATUS.UNDER_VERIFICATION,
    actor.orgId,
    declarationId,
  ]);
  await record(actor, 'VERIFICATION_STARTED', { type: 'DECLARATION', id: declarationId }, `Dossier in behandeling genomen door ${actor.orgName}.`);
  await notify(declaration.org_id, 'VERIFICATION', 'Uw dossier is in behandeling', `${actor.orgName} is met de verificatie gestart.`, `#/declarations/${declarationId}`);
  return get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
}

/**
 * The verifier's decision.
 *
 * A dossier flagged for leaning on a foreign EPD can still be approved - the
 * rules allow that where no BEPD exists - but it keeps its flag and never feeds
 * the sector averages. A dossier with a missing or unverified input cannot be
 * approved at all: a verifier cannot certify away a gap upstream, and having
 * the button available would invite exactly that.
 */
export async function decideVerification(declarationId, { approve, note, certificateNo }, actor) {
  const declaration = await get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
  if (!declaration) throw notFound('Declaratie niet gevonden.');

  if (approve && !approvable(declaration.verdict)) {
    const err = new Error(
      `Dit dossier heeft de status "${declaration.verdict}" en kan niet worden goedgekeurd. Een ontbrekend of niet-geverifieerd bewijsstuk bij een grondstof kan de verificateur niet opheffen.`,
    );
    err.status = 422;
    throw err;
  }

  const now = nowIso();
  const validityMonths = await getSettingNumber('declaration_validity_months', 60);

  await run(
    `UPDATE declarations
        SET status = ?, verified_at = ?, verified_by = ?, verifier_org_id = ?,
            certificate_no = ?, valid_until = ?, decision_note = ?
      WHERE id = ?`,
    [
      approve ? DECLARATION_STATUS.VERIFIED : DECLARATION_STATUS.REJECTED,
      approve ? now : null,
      actor.id,
      actor.orgId,
      approve ? certificateNo ?? (await nextCertificateNumber()) : null,
      approve ? addMonths(now, validityMonths) : null,
      note ?? null,
      declarationId,
    ],
  );

  await record(
    actor,
    approve ? 'DECLARATION_VERIFIED' : 'DECLARATION_REJECTED',
    { type: 'DECLARATION', id: declarationId },
    approve ? `Dossier goedgekeurd door ${actor.orgName}.` : `Dossier afgekeurd door ${actor.orgName}.`,
    { note },
  );
  await notify(
    declaration.org_id,
    approve ? 'VERIFIED' : 'REJECTED',
    approve ? 'Uw dossier is goedgekeurd' : 'Uw dossier is afgekeurd',
    note ?? null,
    `#/declarations/${declarationId}`,
  );

  return get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
}

/** Publishing makes the dossier visible to the federation's aggregation. */
export async function publishDeclaration(declarationId, actor) {
  const declaration = await get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
  if (!declaration) throw notFound('Declaratie niet gevonden.');
  if (declaration.status !== DECLARATION_STATUS.VERIFIED) {
    const err = new Error('Alleen een geverifieerd dossier kan gepubliceerd worden.');
    err.status = 422;
    throw err;
  }

  await run('UPDATE declarations SET status = ? WHERE id = ?', [DECLARATION_STATUS.PUBLISHED, declarationId]);
  await record(actor, 'DECLARATION_PUBLISHED', { type: 'DECLARATION', id: declarationId }, 'Dossier gepubliceerd; het telt mee in de sectorgemiddelden.');
  return get('SELECT * FROM declarations WHERE id = ?', [declarationId]);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function declarationDetail(declarationId) {
  const declaration = await get(
    `SELECT d.*, r.code AS recipe_code, r.name AS recipe_name, r.strength_class, r.exposure_classes,
            rv.version_no, rv.effective_from, rv.change_reason,
            o.name AS producer_name, v.name AS verifier_name
       FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN organisations o ON o.id = d.org_id
       LEFT JOIN organisations v ON v.id = d.verifier_org_id
      WHERE d.id = ?`,
    [declarationId],
  );
  if (!declaration) return null;

  const gates = await all(
    "SELECT * FROM gate_checks WHERE subject_type = 'RECIPE_VERSION' AND subject_id = ? ORDER BY created_at DESC",
    [declaration.recipe_version_id],
  );

  return {
    ...declaration,
    result: declaration.result_json ? JSON.parse(declaration.result_json) : null,
    gates: gates.map((g) => ({ ...g, reasons: g.reasons_json ? JSON.parse(g.reasons_json) : [] })),
  };
}

export async function listDeclarations({ orgId = null, statuses = null, verifierOrgId = null, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (orgId) {
    clauses.push('d.org_id = ?');
    params.push(orgId);
  }
  if (verifierOrgId) {
    clauses.push('(d.verifier_org_id = ? OR d.verifier_org_id IS NULL)');
    params.push(verifierOrgId);
  }
  if (statuses?.length) {
    clauses.push(`d.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  params.push(limit);

  return all(
    `SELECT d.id, d.status, d.verdict, d.scope, d.certificate_no, d.submitted_at, d.verified_at,
            d.valid_until, d.bypass_of, d.bypass_deviation, d.created_at,
            r.code AS recipe_code, r.name AS recipe_name, r.strength_class,
            rv.version_no, o.name AS producer_name, o.id AS producer_org_id,
            v.name AS verifier_name
       FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
       JOIN organisations o ON o.id = d.org_id
       LEFT JOIN organisations v ON v.id = d.verifier_org_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY d.created_at DESC
      LIMIT ?`,
    params,
  );
}

/** The declaration currently in force for a recipe, at a moment in time. */
export async function effectiveDeclarationFor(recipeId, at = nowIso()) {
  return get(
    `SELECT d.* FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
      WHERE rv.recipe_id = ?
        AND d.status IN ('VERIFIED','PUBLISHED','AUTO_ACCEPTED')
        AND rv.effective_from <= ?
        AND (d.valid_until IS NULL OR d.valid_until >= ?)
      ORDER BY rv.effective_from DESC
      LIMIT 1`,
    [recipeId, at, at],
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export async function writeGateCheck({ subjectType, subjectId, decision, verdict, deviationPct, thresholdPct, reasons, actor, note }) {
  const gateId = id('gate');
  await run(
    `INSERT INTO gate_checks
      (id, subject_type, subject_id, decision, verdict, deviation_pct, threshold_pct, reasons_json, actor_user_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gateId,
      subjectType,
      subjectId,
      decision,
      verdict ?? null,
      deviationPct ?? null,
      thresholdPct ?? null,
      JSON.stringify(reasons ?? []),
      actor?.id ?? null,
      note ?? null,
      nowIso(),
    ],
  );
  return gateId;
}

async function nextCertificateNumber() {
  const row = await get("SELECT COUNT(*) AS n FROM declarations WHERE certificate_no IS NOT NULL");
  const n = Number(row?.n ?? 0) + 1;
  return `BEPD-${new Date().getUTCFullYear()}-BET-${String(n).padStart(4, '0')}`;
}

export function addMonths(iso, months) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '0,00 %';
  return `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')} %`;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}
