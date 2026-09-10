/**
 * The transparency report.
 *
 * This is the artefact the whole platform exists to produce. The federal
 * administration's condition was that the calculation rules used inside the
 * tool are "sluitend en transparant" - one button, and out comes a document
 * that shows every value, where it came from and who is answerable for it.
 *
 * So the report is not a summary. It contains:
 *   - the inputs, each with the declaration number behind it
 *   - every parameter, marked as sector default or measured override, with the
 *     justification text attached to the override
 *   - every term of the calculation with its own formula and factor source
 *   - the master data actually used, with its source reference and version date
 *   - the validity verdict with its reasoning
 *   - the audit trail of who changed what
 *
 * The payload is deliberately renderer-agnostic: the client turns it into a
 * printable page, and a future PDF export or an API consumer reads the same
 * structure.
 */
import { all, get } from '../db/index.js';
import { forEntity } from '../lib/audit.js';
import { calculateRecipeVersion, resolveTransportProfile, resolveEnergyFactor } from './calc.js';
import { evaluateChange } from './changes.js';
import { componentsOf, parametersOf, nowIso } from './versioning.js';
import {
  INDICATORS,
  INDICATOR_BY_CODE,
  LEAD_INDICATOR,
  MODULES,
  PARAMETER_BY_CODE,
  EVIDENCE_TYPES,
  VERDICTS,
  DECLARATION_STATUS_LABELS,
} from './constants.js';

export async function buildReport({ recipeVersionId, declarationId = null, scope = 'A1-A3', at = null }) {
  const referenceDate = at ?? nowIso();

  const declaration = declarationId
    ? await get('SELECT * FROM declarations WHERE id = ?', [declarationId])
    : await get(
        "SELECT * FROM declarations WHERE recipe_version_id = ? AND status <> 'REJECTED' ORDER BY created_at DESC LIMIT 1",
        [recipeVersionId],
      );

  // A verified dossier reports the numbers that were verified, not today's
  // recalculation. That distinction is the difference between a declaration and
  // a spreadsheet.
  const snapshot = declaration?.result_json ? JSON.parse(declaration.result_json) : null;
  const live = await calculateRecipeVersion(recipeVersionId, { scope, at: referenceDate });
  const result = snapshot ?? live;

  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [recipeVersionId]);
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);
  const producer = await get('SELECT * FROM organisations WHERE id = ?', [recipe.org_id]);
  const site = recipe.site_id ? await get('SELECT * FROM sites WHERE id = ?', [recipe.site_id]) : null;
  const verifier = declaration?.verifier_org_id ? await get('SELECT * FROM organisations WHERE id = ?', [declaration.verifier_org_id]) : null;

  const components = await componentsOf(recipeVersionId);
  const parameters = await parametersOf(recipeVersionId);

  return {
    meta: {
      title: `Milieuprofiel ${recipe.code}`,
      generatedAt: nowIso(),
      referenceDate,
      engineVersion: result.engineVersion,
      standard: 'EN 15804+A2',
      functionalUnit: result.functionalUnit,
      scope: result.scope,
      // Says out loud whether the numbers below are the verified snapshot or a
      // recalculation, because they can legitimately differ.
      basis: snapshot ? 'SNAPSHOT' : 'LIVE',
      basisNote: snapshot
        ? 'De cijfers hieronder zijn de vastgelegde momentopname zoals ingediend en geverifieerd. Een herberekening vandaag kan afwijken doordat masterdata intussen is bijgewerkt.'
        : 'Deze berekening is vandaag uitgevoerd op de actuele masterdata en is nog niet geverifieerd vastgelegd.',
      drift: snapshot ? driftBetween(snapshot, live) : null,
    },

    subject: {
      producer: { name: producer.name, vat: producer.vat, city: producer.city },
      site: site ? { name: site.name, city: site.city, note: site.note } : null,
      recipe: {
        code: recipe.code,
        name: recipe.name,
        strengthClass: recipe.strength_class,
        exposureClasses: recipe.exposure_classes,
        consistency: recipe.consistency,
        dmax: recipe.dmax,
        density: recipe.density,
        benor: !!recipe.benor,
      },
      version: {
        id: version.id,
        number: version.version_no,
        status: version.status,
        effectiveFrom: version.effective_from,
        effectiveTo: version.effective_to,
        changeReason: version.change_reason,
      },
    },

    declaration: declaration
      ? {
          id: declaration.id,
          status: declaration.status,
          statusLabel: DECLARATION_STATUS_LABELS[declaration.status] ?? declaration.status,
          scope: declaration.scope,
          certificateNo: declaration.certificate_no,
          verdict: declaration.verdict,
          submittedAt: declaration.submitted_at,
          verifiedAt: declaration.verified_at,
          validUntil: declaration.valid_until,
          decisionNote: declaration.decision_note,
          verifier: verifier ? { name: verifier.name, city: verifier.city } : null,
          inheritedFrom: declaration.bypass_of,
          inheritedDeviationPct: declaration.bypass_deviation,
        }
      : null,

    /* --- what went in --------------------------------------------- */
    inputs: await Promise.all(
      components.map(async (component) => {
        const materialVersion = await get('SELECT * FROM material_versions WHERE id = ?', [component.material_version_id]);
        const evidence = materialVersion?.evidence_id ? await get('SELECT * FROM evidence WHERE id = ?', [materialVersion.evidence_id]) : null;
        const summary = result.components?.find((c) => c.materialVersionId === component.material_version_id);
        return {
          name: component.material_name,
          code: component.material_code,
          category: component.category,
          supplier: component.supplier_name,
          quantityKg: component.quantity_kg,
          transportKm: component.transport_km,
          transportProfile: summary?.transportProfile ?? null,
          inboundIncluded: !!materialVersion?.includes_inbound_transport,
          materialVersion: materialVersion ? { number: materialVersion.version_no, effectiveFrom: materialVersion.effective_from } : null,
          evidence: evidence
            ? {
                type: evidence.type,
                typeLabel: EVIDENCE_TYPES[evidence.type]?.label ?? evidence.type,
                number: evidence.number,
                programme: evidence.programme,
                issuer: evidence.issuer,
                validFrom: evidence.valid_from,
                validUntil: evidence.valid_until,
                documentUrl: evidence.document_url,
              }
            : null,
          leadContribution: summary?.contribution?.[LEAD_INDICATOR] ?? null,
        };
      }),
    ),

    parameters: parameters.map((p) => ({
      code: p.code,
      label: PARAMETER_BY_CODE[p.code]?.label ?? p.code,
      module: PARAMETER_BY_CODE[p.code]?.module ?? null,
      value: p.value,
      unit: p.unit,
      source: p.source,
      overridden: !!p.overridden,
      justification: p.justification,
      attachmentUrl: p.attachment_url,
    })),

    /* --- how it was calculated ------------------------------------ */
    calculation: {
      modules: MODULES.filter((m) => result.modules.includes(m.code)).map((module) => ({
        ...module,
        lines: (result.trace ?? []).filter((line) => line.module === module.code),
        subtotal: result.byModule?.[module.code]?.[LEAD_INDICATOR] ?? 0,
      })),
      leadIndicator: { code: LEAD_INDICATOR, unit: INDICATOR_BY_CODE[LEAD_INDICATOR].unit, total: result.totals[LEAD_INDICATOR] },
    },

    /* --- the numbers ---------------------------------------------- */
    results: {
      indicators: INDICATORS.map((indicator) => ({
        code: indicator.code,
        label: indicator.label,
        short: indicator.short,
        unit: indicator.unit,
        group: indicator.group,
        total: result.totals[indicator.code] ?? 0,
        byModule: Object.fromEntries(result.modules.map((m) => [m, result.byModule?.[m]?.[indicator.code] ?? 0])),
      })),
      modules: result.modules,
    },

    /* --- may it be used? ------------------------------------------ */
    validity: {
      verdict: result.verdict,
      verdictLabel: VERDICTS[result.verdict]?.label ?? result.verdict,
      verdictDescription: VERDICTS[result.verdict]?.description ?? null,
      reasons: result.reasons ?? [],
      rule: 'Een resultaat is pas als BEPD bruikbaar wanneer élke grondstof in de samenstelling zelf door een geldige BEPD gedekt is. Eén ontbrekend bewijsstuk maakt het volledige resultaat ongeldig.',
    },

    /* --- provenance of the master data ----------------------------- */
    masterData: await masterDataUsed(components, parameters, referenceDate),

    changeControl: await evaluateChange(recipeVersionId, { at: referenceDate, result: live }).catch(() => null),

    audit: await forEntity('RECIPE', recipe.id, 40),
  };
}

/**
 * Every factor the calculation actually touched, with its source and the date
 * its version took effect. Without this the trace lines cite factors nobody can
 * look up.
 */
async function masterDataUsed(components, parameters, at) {
  const transport = new Map();
  for (const component of components) {
    if (!component.transport_profile_id || !component.transport_km) continue;
    const profile = await resolveTransportProfile(component.transport_profile_id, at);
    if (profile) transport.set(profile.id, profile);
  }

  const energy = new Map();
  for (const parameter of parameters) {
    const def = PARAMETER_BY_CODE[parameter.code];
    if (!def?.factor) continue;
    const factor = await resolveEnergyFactor(def.factor, at);
    if (factor) energy.set(factor.id, factor);
  }

  const categories = await all('SELECT * FROM category_rules ORDER BY category');
  const used = new Set(components.map((c) => c.category));

  return {
    transportProfiles: [...transport.values()].map((p) => ({
      code: p.code,
      name: p.name,
      mode: p.mode,
      source: p.source,
      validFrom: p.valid_from,
      emptyReturn: !!p.empty_return,
      leadValue: p.values[LEAD_INDICATOR],
      leadUnit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/tkm`,
    })),
    energyFactors: [...energy.values()].map((f) => ({
      code: f.code,
      name: f.name,
      unit: f.unit,
      source: f.source,
      validFrom: f.valid_from,
      leadValue: f.values[LEAD_INDICATOR],
      leadUnit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/${f.unit}`,
    })),
    categoryRules: categories.filter((c) => used.has(c.category)),
  };
}

/** How far a live recalculation has moved away from the verified snapshot. */
function driftBetween(snapshot, live) {
  const before = snapshot.totals?.[LEAD_INDICATOR] ?? 0;
  const after = live.totals?.[LEAD_INDICATOR] ?? 0;
  const pct = before ? ((after - before) / before) * 100 : 0;
  return {
    indicator: LEAD_INDICATOR,
    snapshot: before,
    live: after,
    deltaPct: pct,
    material: Math.abs(pct) > 0.5,
  };
}
