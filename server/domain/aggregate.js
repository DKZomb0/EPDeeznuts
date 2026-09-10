/**
 * Sector aggregation - the generic values that feed TOTEM.
 *
 * An architect designing in 2027 does not yet know which plant will supply the
 * concrete, so the E-peil calculation needs one representative number per
 * strength class. The federation builds that number by averaging the verified
 * declarations of its members.
 *
 * The averaging deliberately reports the *spread* alongside the mean. That is
 * the entire argument the sector is making to the federal administration: a
 * generic 300 kg CO2/m3 hides a real range of roughly 150 to 600 depending on
 * the plant and the cement, and a design decision taken on the mean can be off
 * by a factor of two. An average without its dispersion is what makes the
 * regime look precise while being useless.
 */
import { all, get } from '../db/index.js';
import { INDICATOR_CODES, LEAD_INDICATOR, PRODUCT_MODULES, INDICATOR_BY_CODE } from './constants.js';

/**
 * Build a sector average.
 *
 * @param {object} options
 * @param {string} [options.strengthClass]  e.g. 'C30/37'
 * @param {string} [options.exposureClass]  e.g. 'EE3'
 * @param {string} [options.method]         'VOLUME_WEIGHTED' | 'SIMPLE'
 * @param {string} [options.since]          only count deliveries after this date for weighting
 */
export async function buildAggregation(options = {}) {
  const method = options.method ?? 'VOLUME_WEIGHTED';
  const declarations = await eligibleDeclarations(options);

  const samples = [];
  for (const d of declarations) {
    let result;
    try {
      result = JSON.parse(d.result_json);
    } catch {
      continue;
    }
    if (!result?.totals) continue;

    const weight = method === 'VOLUME_WEIGHTED' ? await deliveredVolume(d, options.since) : 1;

    samples.push({
      declarationId: d.id,
      certificateNo: d.certificate_no,
      // Members are not named in the published aggregate: the federation
      // publishes a sector value, not a league table of its own members.
      producerRef: anonymise(d.org_id),
      recipeCode: d.recipe_code,
      strengthClass: d.strength_class,
      exposureClasses: d.exposure_classes,
      scope: d.scope,
      verdict: d.verdict,
      weight: weight > 0 ? weight : 1,
      hasDeliveries: weight > 0,
      totals: result.totals,
      byModule: result.byModule ?? {},
    });
  }

  const stats = {};
  for (const indicator of INDICATOR_CODES) {
    stats[indicator] = describe(samples.map((s) => ({ value: s.totals[indicator] ?? 0, weight: s.weight })));
  }

  const byModule = {};
  for (const module of PRODUCT_MODULES) {
    byModule[module] = describe(
      samples.map((s) => ({ value: s.byModule?.[module]?.[LEAD_INDICATOR] ?? 0, weight: s.weight })),
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    method,
    filter: {
      strengthClass: options.strengthClass ?? null,
      exposureClass: options.exposureClass ?? null,
      since: options.since ?? null,
    },
    sampleSize: samples.length,
    totalWeight: samples.reduce((sum, s) => sum + s.weight, 0),
    lead: {
      indicator: LEAD_INDICATOR,
      unit: INDICATOR_BY_CODE[LEAD_INDICATOR].unit,
      ...stats[LEAD_INDICATOR],
    },
    indicators: stats,
    leadByModule: byModule,
    samples: samples.map(({ totals, byModule: _bm, ...rest }) => ({
      ...rest,
      lead: totals[LEAD_INDICATOR] ?? 0,
    })),
    caveat:
      'Deze generieke waarde is een gewogen gemiddelde over de opgenomen declaraties. De spreiding is bewust mee gerapporteerd: een ontwerpberekening op het gemiddelde kan aanzienlijk afwijken van de werkelijk geleverde receptuur.',
  };
}

async function eligibleDeclarations({ strengthClass, exposureClass } = {}) {
  const clauses = ["d.status = 'PUBLISHED'", "d.verdict = 'VALID'", 'd.result_json IS NOT NULL'];
  const params = [];
  if (strengthClass) {
    clauses.push('r.strength_class = ?');
    params.push(strengthClass);
  }
  if (exposureClass) {
    clauses.push('lower(r.exposure_classes) LIKE lower(?)');
    params.push(`%${exposureClass}%`);
  }
  return all(
    `SELECT d.*, r.code AS recipe_code, r.strength_class, r.exposure_classes
       FROM declarations d
       JOIN recipe_versions rv ON rv.id = d.recipe_version_id
       JOIN recipes r ON r.id = rv.recipe_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.verified_at DESC`,
    params,
  );
}

/**
 * Volume delivered under a declaration.
 *
 * A declaration does not only cover the version it was filed for: every later
 * version that stayed inside the change-control margin inherited it. Weighting
 * on the filed version alone would credit a plant with the volume of its oldest
 * recipe revision and ignore everything it actually shipped since, which is the
 * opposite of what volume weighting is for. So the lineage is walked first.
 */
async function deliveredVolume(declaration, since = null) {
  const versionIds = await coveredVersionIds(declaration.id, declaration.recipe_version_id);
  const placeholders = versionIds.map(() => '?').join(',');
  const params = [...versionIds];
  let window = '';
  if (since) {
    window = 'AND delivered_at >= ?';
    params.push(since);
  }
  const row = await get(
    `SELECT COALESCE(SUM(volume_m3), 0) AS v FROM deliveries WHERE recipe_version_id IN (${placeholders}) ${window}`,
    params,
  );
  return Number(row?.v ?? 0);
}

/** The declaration itself plus every declaration that inherited from it. */
async function coveredVersionIds(declarationId, rootVersionId) {
  const versionIds = new Set([rootVersionId]);
  let frontier = [declarationId];

  // Bypasses can chain, so this walks until nothing new turns up rather than
  // assuming a single level.
  while (frontier.length) {
    const placeholders = frontier.map(() => '?').join(',');
    const children = await all(
      `SELECT id, recipe_version_id FROM declarations WHERE bypass_of IN (${placeholders})`,
      frontier,
    );
    frontier = [];
    for (const child of children) {
      if (versionIds.has(child.recipe_version_id)) continue;
      versionIds.add(child.recipe_version_id);
      frontier.push(child.id);
    }
  }
  return [...versionIds];
}

/**
 * Weighted mean plus the dispersion that makes the mean honest.
 */
export function describe(entries) {
  const clean = entries.filter((e) => Number.isFinite(e.value));
  if (!clean.length) {
    return { n: 0, mean: 0, weightedMean: 0, min: 0, max: 0, p25: 0, median: 0, p75: 0, stdev: 0, cv: 0, spreadPct: 0 };
  }

  const values = clean.map((e) => e.value).sort((a, b) => a - b);
  const n = values.length;
  const totalWeight = clean.reduce((s, e) => s + (e.weight || 0), 0);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const weightedMean = totalWeight > 0 ? clean.reduce((s, e) => s + e.value * e.weight, 0) / totalWeight : mean;

  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const min = values[0];
  const max = values[n - 1];

  return {
    n,
    mean,
    weightedMean,
    min,
    max,
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    stdev,
    cv: mean !== 0 ? (stdev / mean) * 100 : 0,
    // How far the extremes sit from the mean - the number the sector quotes
    // when it argues that one generic value cannot represent all concrete.
    spreadPct: mean !== 0 ? ((max - min) / mean) * 100 : 0,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (idx - low);
}

/**
 * TOTEM-facing export.
 *
 * TOTEM is the Flemish platform architects use for the material side of the
 * E-peil. The shape here is a neutral, self-describing envelope: the actual
 * exchange format still has to be agreed with OVAM, so the payload documents
 * its own units and scope rather than guessing at their schema.
 */
export function toTotemPayload(aggregation, label) {
  return {
    format: 'EPDEEZNUTS_SECTOR_AVERAGE',
    formatVersion: '0.1',
    label,
    generatedAt: aggregation.generatedAt,
    functionalUnit: '1 m³ verhard geleverd beton',
    scope: 'A1-A3',
    standard: 'EN 15804+A2',
    strengthClass: aggregation.filter.strengthClass,
    exposureClass: aggregation.filter.exposureClass,
    basis: {
      method: aggregation.method,
      sampleSize: aggregation.sampleSize,
      note: aggregation.caveat,
    },
    indicators: Object.fromEntries(
      INDICATOR_CODES.map((code) => [
        code,
        {
          unit: INDICATOR_BY_CODE[code].unit,
          value: aggregation.indicators[code].weightedMean,
          min: aggregation.indicators[code].min,
          max: aggregation.indicators[code].max,
          stdev: aggregation.indicators[code].stdev,
          n: aggregation.indicators[code].n,
        },
      ]),
    ),
  };
}

/** Stable pseudonym so a published aggregate cannot be reverse-engineered. */
function anonymise(orgId) {
  let hash = 0;
  for (let i = 0; i < orgId.length; i += 1) hash = (hash * 31 + orgId.charCodeAt(i)) >>> 0;
  return `centrale-${(hash % 900) + 100}`;
}
