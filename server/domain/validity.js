/**
 * Validity: the "is this result worth anything?" logic.
 *
 * A calculation always produces a number. Whether that number may be used as a
 * product declaration is a separate question, and it is decided entirely by the
 * evidence behind every input:
 *
 *   BEPD            -> valid
 *   international   -> valid, but the dossier is flagged and never bypasses
 *                      verification
 *   sector generic  -> indicative only; fine for an architect's design-phase
 *                      E-peil estimate, never a product declaration
 *   self declared   -> the arithmetic runs, the result is void
 *
 * The rollup takes the worst verdict found anywhere in the tree. One raw
 * material without a BEPD invalidates the concrete built from it - that is the
 * rule the sector asked for and it is deliberately unforgiving.
 */
import { EVIDENCE_TYPES, VERDICTS, worstVerdict } from './constants.js';

/** Severity of a single finding, mapped onto the verdict ladder. */
export const REASON_SEVERITY = { INFO: 'VALID', WARNING: 'VALID_WITH_WARNINGS', INDICATIVE: 'INDICATIVE', BLOCKING: 'INVALID' };

function reason(code, severity, message, subject = null, detail = null) {
  return { code, severity, verdict: REASON_SEVERITY[severity], message, subject, detail };
}

/**
 * Judge one piece of evidence at a point in time.
 *
 * @param {object|null} evidence  row from `evidence`, or null when absent
 * @param {string} referenceDate  ISO date the judgement applies to
 * @param {string} [subject]      label used in the reason messages
 */
export function evaluateEvidence(evidence, referenceDate, subject = 'input') {
  const reasons = [];

  if (!evidence) {
    reasons.push(
      reason('EVIDENCE_MISSING', 'BLOCKING', `${subject}: geen milieudeclaratie gekoppeld. Zonder BEPD is het eindresultaat ongeldig.`, subject),
    );
    return { verdict: 'INVALID', reasons, evidenceType: null };
  }

  const type = EVIDENCE_TYPES[evidence.type];
  if (!type) {
    reasons.push(reason('EVIDENCE_TYPE_UNKNOWN', 'BLOCKING', `${subject}: onbekend documenttype "${evidence.type}".`, subject));
    return { verdict: 'INVALID', reasons, evidenceType: evidence.type };
  }

  let verdict = type.verdict;

  // A registration number is what makes a BEPD checkable at all. Without one
  // the verifier has nothing to look up, so the claim drops to self-declared.
  if (type.requiresNumber && !String(evidence.number ?? '').trim()) {
    reasons.push(
      reason('EVIDENCE_NUMBER_MISSING', 'BLOCKING', `${subject}: het registratienummer van de ${type.short} ontbreekt, de verklaring is niet controleerbaar.`, subject),
    );
    verdict = 'INVALID';
  }

  const ref = dateOnly(referenceDate);
  if (evidence.valid_until && dateOnly(evidence.valid_until) < ref) {
    reasons.push(
      reason('EVIDENCE_EXPIRED', 'BLOCKING', `${subject}: de ${type.short} is vervallen op ${fmt(evidence.valid_until)} en dekt de referentiedatum ${fmt(referenceDate)} niet.`, subject, {
        validUntil: evidence.valid_until,
        referenceDate,
      }),
    );
    verdict = 'INVALID';
  } else if (evidence.valid_until && withinDays(evidence.valid_until, ref, 90)) {
    reasons.push(
      reason('EVIDENCE_EXPIRING', 'WARNING', `${subject}: de ${type.short} vervalt op ${fmt(evidence.valid_until)}.`, subject, { validUntil: evidence.valid_until }),
    );
  }

  if (evidence.valid_from && dateOnly(evidence.valid_from) > ref) {
    reasons.push(
      reason('EVIDENCE_NOT_YET_VALID', 'BLOCKING', `${subject}: de ${type.short} geldt pas vanaf ${fmt(evidence.valid_from)}.`, subject),
    );
    verdict = 'INVALID';
  }

  if (type.code === 'EPD_INTL') {
    reasons.push(
      reason('EVIDENCE_INTERNATIONAL', 'WARNING', `${subject}: steunt op een internationale EPD (${evidence.programme ?? 'onbekend programma'}) in plaats van een BEPD.`, subject),
    );
  }
  if (type.code === 'SECTOR_GENERIC') {
    reasons.push(
      reason('EVIDENCE_SECTOR_GENERIC', 'INDICATIVE', `${subject}: gebruikt een generieke sectorwaarde. Bruikbaar voor een ontwerpraming, niet als productdeclaratie.`, subject),
    );
  }
  if (type.code === 'SELF_DECLARED') {
    reasons.push(
      reason('EVIDENCE_SELF_DECLARED', 'BLOCKING', `${subject}: eigen opgave zonder externe verificatie. De berekening loopt door maar het resultaat is ongeldig.`, subject),
    );
  }

  return { verdict, reasons, evidenceType: type.code };
}

/**
 * Check that a material version declares every module European product rules
 * make mandatory for its category. Cement declares A1-A3; if only A1 is filled
 * in, the dossier is incomplete rather than merely optimistic.
 */
export function evaluateModuleCoverage(declaredModules, categoryRule, subject) {
  const reasons = [];
  if (!categoryRule) return { verdict: 'VALID', reasons };

  const required = splitModules(categoryRule.required_modules);
  const present = new Set(declaredModules);
  const missing = required.filter((m) => !present.has(m));

  if (missing.length) {
    reasons.push(
      reason('MODULES_INCOMPLETE', 'BLOCKING', `${subject}: verplichte module(s) ${missing.join(', ')} ontbreken voor categorie ${categoryRule.category}.`, subject, {
        required,
        missing,
      }),
    );
    return { verdict: 'INVALID', reasons };
  }
  return { verdict: 'VALID', reasons };
}

/**
 * Roll a set of per-input judgements up into one verdict for the dossier.
 * Returns the worst verdict plus every reason, sorted worst-first so the UI can
 * show the blocking findings at the top without further sorting.
 */
export function rollup(parts) {
  const reasons = parts.flatMap((p) => p.reasons ?? []);
  const verdict = worstVerdict([...parts.map((p) => p.verdict), ...reasons.map((r) => r.verdict)]);
  reasons.sort((a, b) => VERDICTS[b.verdict].severity - VERDICTS[a.verdict].severity);
  return { verdict, reasons };
}

/** True when a verdict still allows the dossier to be published as a BEPD. */
export function publishable(verdict) {
  return verdict === 'VALID';
}

/**
 * May an external verifier sign this dossier off?
 *
 * Belgian rules do allow an input to lean on a foreign EPD where no BEPD
 * exists - an exotic pigment made nowhere in Belgium, say. Such a dossier
 * passes verification carrying its flag; what it may never do is feed the
 * sector's generic values, which `buildAggregation` restricts to VALID.
 *
 * INDICATIVE (built on sector averages) and INVALID (missing or unverified
 * evidence) cannot be signed off at all. A verifier cannot certify away a
 * missing declaration upstream, and offering the button would invite exactly
 * that.
 */
export function approvable(verdict) {
  return verdict === 'VALID' || verdict === 'VALID_WITH_WARNINGS';
}

/** True when a delivery may physically leave the plant on this verdict. */
export function deliverable(verdict) {
  return verdict === 'VALID' || verdict === 'VALID_WITH_WARNINGS';
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function splitModules(csv) {
  return String(csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function dateOnly(v) {
  return String(v ?? '').slice(0, 10);
}

function fmt(v) {
  const d = dateOnly(v);
  if (!d) return '?';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function withinDays(target, from, days) {
  const t = Date.parse(dateOnly(target));
  const f = Date.parse(dateOnly(from));
  if (Number.isNaN(t) || Number.isNaN(f)) return false;
  return t >= f && t - f <= days * 86400_000;
}
