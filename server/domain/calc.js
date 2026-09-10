/**
 * The LCA calculation engine.
 *
 * Functional unit: 1 m3 of fresh concrete, leaving the plant.
 *
 * Every single term the engine produces is emitted as a trace line carrying its
 * own inputs, factor, factor source and evidence. That is not a debugging
 * nicety: the regulator's stated condition for accepting this platform was that
 * the calculation rules are "sluitend en transparant" - one button has to
 * produce a document showing where each number came from. If a term cannot
 * explain itself it does not belong in the engine.
 *
 * ---------------------------------------------------------------------------
 * Module mapping - the one thing an auditor always asks about
 * ---------------------------------------------------------------------------
 * A supplier's declaration covers *its own* life cycle: A1 (winning the raw
 * material), A2 (transport to the supplier's plant), A3 (the supplier's
 * processing). When that product becomes an input to concrete, its entire
 * cradle-to-gate bundle (A1+A2+A3) lands in the concrete's **A1**, and the
 * concrete's **A2** is the leg from the supplier's gate to the concrete plant -
 * a leg nobody upstream can know, because it depends on which plant buys it.
 *
 * So: cement A1-A3  ->  concrete A1
 *     cement gate -> concrete plant  ->  concrete A2   (computed here)
 *     mixing at the concrete plant   ->  concrete A3   (parameters)
 *     concrete plant -> building site ->  concrete A4   (per delivery)
 *     placing, compacting, waste      ->  concrete A5   (contractor's inputs)
 *
 * The trace keeps the upstream module visible on each line so the chain stays
 * readable rather than collapsing into one opaque A1 number.
 */
import { all, get } from '../db/index.js';
import {
  INDICATOR_CODES,
  LEAD_INDICATOR,
  INDICATOR_BY_CODE,
  MODULE_CODES,
  SCOPE_MODULES,
  PARAMETER_BY_CODE,
  DECLARED_UNITS,
  PRODUCT_MODULES,
} from './constants.js';
import { evaluateEvidence, evaluateModuleCoverage, rollup } from './validity.js';
import { componentsOf, parametersOf, materialValues, declaredModules, nowIso } from './versioning.js';

export const ENGINE_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Master data resolution                                              */
/* ------------------------------------------------------------------ */

/**
 * Master data is versioned by `valid_from`; a calculation always resolves the
 * factor that was in force on its reference date, never simply the newest one.
 */
export async function resolveTransportProfile(idOrCode, at = nowIso()) {
  if (!idOrCode) return null;
  const byId = await get('SELECT * FROM transport_profiles WHERE id = ?', [idOrCode]);
  const profile =
    byId ??
    (await get(
      'SELECT * FROM transport_profiles WHERE code = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1',
      [idOrCode, at],
    ));
  if (!profile) return null;
  const rows = await all('SELECT indicator, value FROM transport_profile_values WHERE profile_id = ?', [profile.id]);
  return { ...profile, values: Object.fromEntries(rows.map((r) => [r.indicator, r.value])) };
}

export async function resolveEnergyFactor(code, at = nowIso()) {
  if (!code) return null;
  const factor = await get(
    'SELECT * FROM energy_factors WHERE code = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1',
    [code, at],
  );
  if (!factor) return null;
  const rows = await all('SELECT indicator, value FROM energy_factor_values WHERE factor_id = ?', [factor.id]);
  return { ...factor, values: Object.fromEntries(rows.map((r) => [r.indicator, r.value])) };
}

/* ------------------------------------------------------------------ */
/* Vector maths over the indicator set                                 */
/* ------------------------------------------------------------------ */

export function emptyVector() {
  return Object.fromEntries(INDICATOR_CODES.map((c) => [c, 0]));
}

export function scale(vector, factor) {
  const out = {};
  for (const code of INDICATOR_CODES) out[code] = (vector?.[code] ?? 0) * factor;
  return out;
}

export function addInto(target, vector) {
  for (const code of INDICATOR_CODES) target[code] = (target[code] ?? 0) + (vector?.[code] ?? 0);
  return target;
}

/** kg represented by one declared unit of a material. */
export function declaredUnitKg(declaredUnit, density) {
  const unit = DECLARED_UNITS[declaredUnit];
  if (!unit) return 1000;
  if (unit.kg !== null) return unit.kg;
  // Declared per m3: needs the material's own density to become a mass.
  return Number(density) > 0 ? Number(density) : 1000;
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

/**
 * Calculate one recipe version.
 *
 * @param {string} recipeVersionId
 * @param {object} [options]
 * @param {string} [options.at]        reference date; defaults to now
 * @param {string} [options.scope]     'A1-A3' (default) or 'A1-A5'
 * @param {object} [options.site]      { distanceKm, transportProfileId } for A4
 * @param {object[]} [options.siteParameters]  contractor's A5 parameters
 * @param {number} [options.volumeM3]  when set, totals are also given absolute
 */
export async function calculateRecipeVersion(recipeVersionId, options = {}) {
  const at = options.at ?? nowIso();
  const scope = options.scope ?? 'A1-A3';
  const modules = SCOPE_MODULES[scope] ?? PRODUCT_MODULES;

  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [recipeVersionId]);
  if (!version) throw new Error(`recipe version ${recipeVersionId} not found`);
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);
  const components = await componentsOf(recipeVersionId);
  const parameters = await parametersOf(recipeVersionId);

  const trace = [];
  const byModule = Object.fromEntries(MODULE_CODES.map((m) => [m, emptyVector()]));
  const judgements = [];
  const componentSummaries = [];

  /* ---------------- A1 + A2: the mix ---------------- */

  for (const component of components) {
    const summary = await addComponent({ component, at, trace, byModule, judgements });
    componentSummaries.push(summary);
  }

  if (!components.length) {
    judgements.push({
      verdict: 'INVALID',
      reasons: [
        {
          code: 'RECIPE_EMPTY',
          severity: 'BLOCKING',
          verdict: 'INVALID',
          message: 'De receptuur bevat geen enkele grondstof; er valt niets te berekenen.',
          subject: recipe?.code ?? recipeVersionId,
        },
      ],
    });
  }

  /* ---------------- A3: the plant ---------------- */

  const paramMap = Object.fromEntries(parameters.map((p) => [p.code, p]));
  for (const code of ['PLANT_ELECTRICITY', 'PLANT_DIESEL', 'PLANT_WATER']) {
    await addParameterTerm({ code, param: paramMap[code], at, trace, byModule, judgements });
  }

  // Production loss lifts everything produced so far: the material that ends up
  // as returned concrete or wash water was still won, hauled and mixed.
  await addLossTerm({
    code: 'PLANT_LOSS_PCT',
    param: paramMap.PLANT_LOSS_PCT,
    over: ['A1', 'A2', 'A3'],
    into: 'A3',
    label: 'Productieverlies op de centrale',
    trace,
    byModule,
  });

  /* ---------------- A4 + A5: to and on the site ---------------- */

  if (modules.includes('A4')) {
    await addSiteTransport({ recipe, site: options.site, at, trace, byModule, judgements });
  }

  if (modules.includes('A5')) {
    const siteParams = Object.fromEntries((options.siteParameters ?? []).map((p) => [p.code, p]));
    for (const code of ['SITE_PUMP_ELECTRICITY', 'SITE_VIBRATION_ELECTRICITY', 'SITE_FORMWORK']) {
      await addParameterTerm({ code, param: siteParams[code], at, trace, byModule, judgements });
    }
    await addLossTerm({
      code: 'SITE_WASTE_PCT',
      param: siteParams.SITE_WASTE_PCT,
      over: ['A1', 'A2', 'A3', 'A4'],
      into: 'A5',
      label: 'Verlies op de werf',
      trace,
      byModule,
    });
  }

  /* ---------------- roll up ---------------- */

  const totals = emptyVector();
  for (const m of modules) addInto(totals, byModule[m]);

  const { verdict, reasons } = rollup(judgements);

  const result = {
    engineVersion: ENGINE_VERSION,
    calculatedAt: nowIso(),
    referenceDate: at,
    functionalUnit: '1 m³ verhard geleverd beton',
    scope,
    modules,
    subject: {
      type: 'RECIPE_VERSION',
      id: recipeVersionId,
      recipeId: recipe?.id,
      code: recipe?.code,
      name: recipe?.name,
      strengthClass: recipe?.strength_class,
      exposureClasses: recipe?.exposure_classes,
      density: recipe?.density,
      versionNo: version.version_no,
      versionStatus: version.status,
      effectiveFrom: version.effective_from,
    },
    totals,
    byModule: Object.fromEntries(MODULE_CODES.map((m) => [m, byModule[m]])),
    lead: {
      indicator: LEAD_INDICATOR,
      unit: INDICATOR_BY_CODE[LEAD_INDICATOR].unit,
      total: totals[LEAD_INDICATOR],
      byModule: Object.fromEntries(MODULE_CODES.map((m) => [m, byModule[m][LEAD_INDICATOR]])),
    },
    trace,
    components: componentSummaries,
    parameters: parameters.map((p) => ({
      code: p.code,
      label: PARAMETER_BY_CODE[p.code]?.label ?? p.code,
      value: p.value,
      unit: p.unit,
      source: p.source,
      overridden: !!p.overridden,
      justification: p.justification,
    })),
    verdict,
    reasons,
  };

  if (options.volumeM3) {
    result.volumeM3 = options.volumeM3;
    result.absolute = scale(totals, options.volumeM3);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Term builders                                                       */
/* ------------------------------------------------------------------ */

async function addComponent({ component, at, trace, byModule, judgements }) {
  const materialVersion = await get('SELECT * FROM material_versions WHERE id = ?', [component.material_version_id]);
  const evidence = materialVersion?.evidence_id
    ? await get('SELECT * FROM evidence WHERE id = ?', [materialVersion.evidence_id])
    : null;

  const label = `${component.material_name} (${component.supplier_name})`;

  // Evidence and completeness are judged even when the numbers add up fine:
  // an arithmetically perfect result on self-declared data is still void.
  const evidenceJudgement = evaluateEvidence(evidence, at, label);
  judgements.push(evidenceJudgement);

  if (materialVersion) {
    const categoryRule = await get('SELECT * FROM category_rules WHERE category = ?', [component.category]);
    const present = await declaredModules(materialVersion.id);
    judgements.push(evaluateModuleCoverage(present, categoryRule, label));
  }

  const values = materialVersion ? await materialValues(materialVersion.id) : {};
  const unitKg = declaredUnitKg(component.declared_unit, component.material_density);
  const quantityKg = Number(component.quantity_kg) || 0;
  const ratio = unitKg > 0 ? quantityKg / unitKg : 0;

  const summary = {
    componentId: component.id,
    materialId: component.material_id,
    materialVersionId: component.material_version_id,
    name: component.material_name,
    code: component.material_code,
    category: component.category,
    supplier: component.supplier_name,
    supplierOrgId: component.supplier_org_id,
    quantityKg,
    transportKm: Number(component.transport_km) || 0,
    declaredUnit: component.declared_unit,
    evidence: evidenceSummary(evidence, evidenceJudgement),
    contribution: emptyVector(),
  };

  // The supplier's whole cradle-to-gate bundle becomes our A1, one trace line
  // per upstream module so the chain stays visible.
  for (const upstream of PRODUCT_MODULES) {
    const vector = values[upstream];
    if (!vector) continue;
    const contribution = scale(vector, ratio);
    addInto(byModule.A1, contribution);
    addInto(summary.contribution, contribution);

    trace.push({
      module: 'A1',
      upstreamModule: upstream,
      kind: 'MATERIAL',
      label: `${component.material_name} — ${upstreamLabel(upstream)}`,
      detail: `${component.supplier_name}${component.material_code ? ` · ${component.material_code}` : ''}`,
      formula: `${fmtNum(quantityKg)} kg ÷ ${fmtNum(unitKg)} kg/eenheid × ${fmtNum(vector[LEAD_INDICATOR] ?? 0)} ${INDICATOR_BY_CODE[LEAD_INDICATOR].unit} per ${DECLARED_UNITS[component.declared_unit]?.label ?? 'eenheid'}`,
      quantity: { value: quantityKg, unit: 'kg/m³' },
      factor: {
        value: vector[LEAD_INDICATOR] ?? 0,
        unit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit} / ${DECLARED_UNITS[component.declared_unit]?.label ?? 'eenheid'}`,
        source: evidence ? `${evidence.type}${evidence.number ? ` ${evidence.number}` : ''}` : 'geen bewijsstuk',
        reference: evidence?.document_url ?? null,
      },
      values: contribution,
      evidence: evidenceSummary(evidence, evidenceJudgement),
    });
  }

  // Our A2: supplier gate -> our plant. Skipped when the supplier's declaration
  // already delivers to the customer, otherwise it would be counted twice.
  const inboundIncluded = !!materialVersion?.includes_inbound_transport;
  const distance = Number(component.transport_km) || 0;

  if (inboundIncluded) {
    trace.push({
      module: 'A2',
      kind: 'TRANSPORT',
      label: `${component.material_name} — aanvoer naar centrale`,
      detail: 'Reeds inbegrepen in de verklaring van de leverancier (levering franco), niet nogmaals aangerekend.',
      formula: '0 (inbegrepen in A1)',
      quantity: { value: quantityKg, unit: 'kg/m³' },
      factor: { value: 0, unit: '-', source: 'leveranciersverklaring', reference: null },
      values: emptyVector(),
      evidence: evidenceSummary(evidence, evidenceJudgement),
    });
  } else if (distance > 0) {
    const profile = await resolveTransportProfile(component.transport_profile_id ?? 'TRUCK_32T', at);
    if (!profile) {
      judgements.push({
        verdict: 'INVALID',
        reasons: [
          {
            code: 'TRANSPORT_PROFILE_MISSING',
            severity: 'BLOCKING',
            verdict: 'INVALID',
            message: `${label}: er is ${distance} km aanvoer ingegeven maar geen geldig transportprofiel gekozen.`,
            subject: label,
          },
        ],
      });
    } else {
      const tonnes = quantityKg / 1000;
      const tkm = tonnes * distance;
      const contribution = scale(profile.values, tkm);
      addInto(byModule.A2, contribution);
      addInto(summary.contribution, contribution);
      summary.transportProfile = profile.name;

      trace.push({
        module: 'A2',
        kind: 'TRANSPORT',
        label: `${component.material_name} — aanvoer naar centrale`,
        detail: `${profile.name}${profile.empty_return ? ' (incl. leegrit)' : ''}`,
        formula: `${fmtNum(tonnes, 3)} t × ${fmtNum(distance)} km = ${fmtNum(tkm, 2)} tkm × ${fmtNum(profile.values[LEAD_INDICATOR] ?? 0, 4)} ${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/tkm`,
        quantity: { value: tkm, unit: 'tkm' },
        factor: {
          value: profile.values[LEAD_INDICATOR] ?? 0,
          unit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/tkm`,
          source: profile.source,
          reference: profile.code,
        },
        values: contribution,
        evidence: null,
      });
    }
  }

  return summary;
}

/** One plant or site parameter times its energy factor. */
async function addParameterTerm({ code, param, at, trace, byModule, judgements }) {
  const def = PARAMETER_BY_CODE[code];
  if (!def) return;

  const value = Number(param?.value ?? 0);
  if (!value) return;

  const factor = await resolveEnergyFactor(def.factor, at);
  if (!factor) {
    judgements.push({
      verdict: 'INVALID',
      reasons: [
        {
          code: 'FACTOR_MISSING',
          severity: 'BLOCKING',
          verdict: 'INVALID',
          message: `Er is geen geldige omrekeningsfactor "${def.factor}" gevonden voor ${def.label} op ${at.slice(0, 10)}.`,
          subject: def.label,
        },
      ],
    });
    return;
  }

  const contribution = scale(factor.values, value);
  addInto(byModule[def.module], contribution);

  // An overridden sector default is exactly what the external verifier is
  // there to audit, so the trace says so out loud.
  const overridden = !!param?.overridden;
  if (overridden && !String(param?.justification ?? '').trim()) {
    judgements.push({
      verdict: 'VALID_WITH_WARNINGS',
      reasons: [
        {
          code: 'OVERRIDE_WITHOUT_JUSTIFICATION',
          severity: 'WARNING',
          verdict: 'VALID_WITH_WARNINGS',
          message: `${def.label}: de generieke sectorwaarde is overschreven zonder verantwoordingsnota. De verificateur zal hierop toetsen.`,
          subject: def.label,
        },
      ],
    });
  }

  trace.push({
    module: def.module,
    kind: 'PROCESS',
    label: def.label,
    detail: overridden
      ? `Eigen gemeten waarde (${param.justification ? 'verantwoording bijgevoegd' : 'zonder verantwoording'})`
      : 'Generieke sectorwaarde',
    formula: `${fmtNum(value, 3)} ${def.unit} × ${fmtNum(factor.values[LEAD_INDICATOR] ?? 0, 4)} ${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/${factor.unit}`,
    quantity: { value, unit: def.unit },
    factor: {
      value: factor.values[LEAD_INDICATOR] ?? 0,
      unit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/${factor.unit}`,
      source: factor.source,
      reference: factor.code,
    },
    values: contribution,
    overridden,
    justification: param?.justification ?? null,
    evidence: null,
  });
}

/** A percentage loss applied to the modules produced so far. */
async function addLossTerm({ code, param, over, into, label, trace, byModule }) {
  const pct = Number(param?.value ?? 0);
  if (!pct) return;

  const base = emptyVector();
  for (const m of over) addInto(base, byModule[m]);
  const contribution = scale(base, pct / 100);
  addInto(byModule[into], contribution);

  trace.push({
    module: into,
    kind: 'LOSS',
    label,
    detail: `${fmtNum(pct, 2)} % opslag op ${over.join('+')}`,
    formula: `${fmtNum(base[LEAD_INDICATOR], 2)} ${INDICATOR_BY_CODE[LEAD_INDICATOR].unit} × ${fmtNum(pct, 2)} %`,
    quantity: { value: pct, unit: '%' },
    factor: { value: pct / 100, unit: '-', source: param?.source ?? 'SECTOR_DEFAULT', reference: code },
    values: contribution,
    overridden: !!param?.overridden,
    justification: param?.justification ?? null,
    evidence: null,
  });
}

/** A4: the mixer truck from the plant to the building site. */
async function addSiteTransport({ recipe, site, at, trace, byModule, judgements }) {
  const distance = Number(site?.distanceKm ?? 0);
  if (!distance) {
    judgements.push({
      verdict: 'INDICATIVE',
      reasons: [
        {
          code: 'A4_NOT_SPECIFIED',
          severity: 'INDICATIVE',
          verdict: 'INDICATIVE',
          message:
            'Module A4 is opgevraagd maar er is geen werfafstand ingegeven. A4 hoort bij een concrete levering, niet bij de receptuur.',
          subject: 'A4',
        },
      ],
    });
    return;
  }

  const profile = await resolveTransportProfile(site?.transportProfileId ?? 'MIXER_8M3', at);
  if (!profile) return;

  const density = Number(recipe?.density ?? 2350);
  const tonnes = density / 1000;
  const tkm = tonnes * distance;
  const contribution = scale(profile.values, tkm);
  addInto(byModule.A4, contribution);

  trace.push({
    module: 'A4',
    kind: 'TRANSPORT',
    label: 'Transport naar de werf',
    detail: `${profile.name}${profile.empty_return ? ' (incl. leegrit)' : ''}`,
    formula: `${fmtNum(tonnes, 3)} t/m³ × ${fmtNum(distance)} km = ${fmtNum(tkm, 2)} tkm × ${fmtNum(profile.values[LEAD_INDICATOR] ?? 0, 4)} ${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/tkm`,
    quantity: { value: tkm, unit: 'tkm' },
    factor: {
      value: profile.values[LEAD_INDICATOR] ?? 0,
      unit: `${INDICATOR_BY_CODE[LEAD_INDICATOR].unit}/tkm`,
      source: profile.source,
      reference: profile.code,
    },
    values: contribution,
    evidence: null,
  });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function evidenceSummary(evidence, judgement) {
  if (!evidence) return { type: null, verdict: judgement?.verdict ?? 'INVALID', label: 'Geen bewijsstuk' };
  return {
    id: evidence.id,
    type: evidence.type,
    number: evidence.number,
    programme: evidence.programme,
    issuer: evidence.issuer,
    validUntil: evidence.valid_until,
    documentUrl: evidence.document_url,
    verdict: judgement?.verdict ?? null,
  };
}

function upstreamLabel(module) {
  return { A1: 'grondstofwinning bij leverancier', A2: 'aanvoer bij leverancier', A3: 'productie bij leverancier' }[module] ?? module;
}

function fmtNum(n, decimals = 1) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
