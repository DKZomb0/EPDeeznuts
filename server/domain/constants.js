/**
 * Domain vocabulary for the platform.
 *
 * Everything that the calculation, the validity verdict and the UI agree on
 * lives here. Codes are stable identifiers and are persisted in the database;
 * labels are Dutch because the users are the Flemish concrete sector.
 */

/* ------------------------------------------------------------------ */
/* Organisation types & roles                                          */
/* ------------------------------------------------------------------ */

export const ORG_TYPES = {
  SUPPLIER: 'SUPPLIER',
  PRODUCER: 'PRODUCER',
  CONTRACTOR: 'CONTRACTOR',
  VERIFIER: 'VERIFIER',
  FEDERATION: 'FEDERATION',
  REGULATOR: 'REGULATOR',
  PLATFORM: 'PLATFORM',
};

export const ORG_TYPE_LABELS = {
  SUPPLIER: 'Grondstofleverancier',
  PRODUCER: 'Betonproducent',
  CONTRACTOR: 'Aannemer',
  VERIFIER: 'Verificatie-instelling',
  FEDERATION: 'Sectorfederatie',
  REGULATOR: 'Overheid / toezicht',
  PLATFORM: 'Platformbeheer',
};

export const USER_ROLES = { ADMIN: 'ADMIN', EDITOR: 'EDITOR', VIEWER: 'VIEWER' };

/* ------------------------------------------------------------------ */
/* EN 15804+A2 life cycle modules                                      */
/* ------------------------------------------------------------------ */

export const MODULES = [
  { code: 'A1', stage: 'PRODUCT', label: 'Grondstofwinning', description: 'Winning en productie van de grondstof zelf.' },
  { code: 'A2', stage: 'PRODUCT', label: 'Transport naar productie', description: 'Transport van de grondstof naar de productiesite.' },
  { code: 'A3', stage: 'PRODUCT', label: 'Productie', description: 'Verwerking en menging op de eigen site.' },
  { code: 'A4', stage: 'CONSTRUCTION', label: 'Transport naar werf', description: 'Transport van het eindproduct naar de bouwplaats.' },
  { code: 'A5', stage: 'CONSTRUCTION', label: 'Installatie op werf', description: 'Verwerking, verdichting, bekisting en afval op de bouwplaats.' },
];

export const MODULE_CODES = MODULES.map((m) => m.code);
export const PRODUCT_MODULES = ['A1', 'A2', 'A3'];
export const CONSTRUCTION_MODULES = ['A4', 'A5'];

/** Declaration scopes: how far down the life cycle a dossier reaches. */
export const SCOPES = {
  A1_A3: 'A1-A3',
  A1_A5: 'A1-A5',
};

export const SCOPE_MODULES = {
  'A1-A3': PRODUCT_MODULES,
  'A1-A5': MODULE_CODES,
};

/* ------------------------------------------------------------------ */
/* EN 15804+A2 core environmental indicators                           */
/* ------------------------------------------------------------------ */

export const INDICATORS = [
  { code: 'GWP_TOTAL', label: 'Global warming potential - totaal', short: 'GWP-totaal', unit: 'kg CO₂ eq.', group: 'IMPACT', lead: 1, sort: 1 },
  { code: 'GWP_FOSSIL', label: 'Global warming potential - fossiel', short: 'GWP-fossiel', unit: 'kg CO₂ eq.', group: 'IMPACT', sort: 2 },
  { code: 'GWP_BIOGENIC', label: 'Global warming potential - biogeen', short: 'GWP-biogeen', unit: 'kg CO₂ eq.', group: 'IMPACT', sort: 3 },
  { code: 'GWP_LULUC', label: 'Global warming potential - landgebruik', short: 'GWP-luluc', unit: 'kg CO₂ eq.', group: 'IMPACT', sort: 4 },
  { code: 'ODP', label: 'Aantasting van de ozonlaag', short: 'ODP', unit: 'kg CFC-11 eq.', group: 'IMPACT', sort: 5 },
  { code: 'AP', label: 'Verzuring', short: 'AP', unit: 'mol H⁺ eq.', group: 'IMPACT', sort: 6 },
  { code: 'EP_FRESHWATER', label: 'Eutrofiëring zoetwater', short: 'EP-zoetwater', unit: 'kg P eq.', group: 'IMPACT', sort: 7 },
  { code: 'EP_MARINE', label: 'Eutrofiëring marien', short: 'EP-marien', unit: 'kg N eq.', group: 'IMPACT', sort: 8 },
  { code: 'EP_TERRESTRIAL', label: 'Eutrofiëring terrestrisch', short: 'EP-terrestrisch', unit: 'mol N eq.', group: 'IMPACT', sort: 9 },
  { code: 'POCP', label: 'Fotochemische ozonvorming', short: 'POCP', unit: 'kg NMVOS eq.', group: 'IMPACT', sort: 10 },
  { code: 'ADPE', label: 'Uitputting mineralen en metalen', short: 'ADP-mineralen', unit: 'kg Sb eq.', group: 'IMPACT', sort: 11 },
  { code: 'ADPF', label: 'Uitputting fossiele brandstoffen', short: 'ADP-fossiel', unit: 'MJ', group: 'IMPACT', sort: 12 },
  { code: 'WDP', label: 'Waterverbruik', short: 'WDP', unit: 'm³ world eq. deprived', group: 'IMPACT', sort: 13 },
  { code: 'PENRT', label: 'Totaal niet-hernieuwbare primaire energie', short: 'PENRT', unit: 'MJ', group: 'RESOURCE', sort: 14 },
  { code: 'PERT', label: 'Totaal hernieuwbare primaire energie', short: 'PERT', unit: 'MJ', group: 'RESOURCE', sort: 15 },
];

export const INDICATOR_CODES = INDICATORS.map((i) => i.code);
/** The indicator every screen leads with, and the one the change rules watch. */
export const LEAD_INDICATOR = 'GWP_TOTAL';

export const INDICATOR_BY_CODE = Object.fromEntries(INDICATORS.map((i) => [i.code, i]));

/* ------------------------------------------------------------------ */
/* Material categories                                                 */
/* ------------------------------------------------------------------ */

export const MATERIAL_CATEGORIES = [
  { code: 'CEMENT', label: 'Cement', defaultUnit: 'TONNE' },
  { code: 'AGGREGATE_FINE', label: 'Zand', defaultUnit: 'TONNE' },
  { code: 'AGGREGATE_COARSE', label: 'Grind / steenslag', defaultUnit: 'TONNE' },
  { code: 'ADDITION', label: 'Toevoegsel (vliegas, slak, filler)', defaultUnit: 'TONNE' },
  { code: 'ADMIXTURE', label: 'Hulpstof', defaultUnit: 'TONNE' },
  { code: 'WATER', label: 'Aanmaakwater', defaultUnit: 'TONNE' },
  { code: 'PIGMENT', label: 'Pigment / kleurstof', defaultUnit: 'TONNE' },
  { code: 'FIBRE', label: 'Vezels', defaultUnit: 'TONNE' },
  { code: 'REINFORCEMENT', label: 'Wapening', defaultUnit: 'TONNE' },
];

export const DECLARED_UNITS = {
  TONNE: { code: 'TONNE', label: '1 ton', kg: 1000 },
  KG: { code: 'KG', label: '1 kg', kg: 1 },
  M3: { code: 'M3', label: '1 m³', kg: null }, // needs density
};

/* ------------------------------------------------------------------ */
/* Evidence: the heart of the "is it valid?" question                  */
/* ------------------------------------------------------------------ */

/**
 * Evidence tiers, ordered from strongest to weakest.
 *
 * The rule the sector agreed on: a declaration is only a BEPD when *every*
 * upstream input is itself BEPD-backed. Anything weaker degrades the result -
 * an international EPD or a sector average still produces a number, but the
 * number carries a flag and can never be published as a product-specific BEPD.
 * Self-declared data produces an arithmetically correct but legally void result.
 */
export const EVIDENCE_TYPES = {
  BEPD: {
    code: 'BEPD',
    tier: 0,
    label: 'BEPD (geverifieerd, Belgisch)',
    short: 'BEPD',
    description: 'Belgian Environmental Product Declaration - een LCA die door een externe instelling geverifieerd en nationaal geregistreerd is.',
    requiresNumber: true,
    verdict: 'VALID',
  },
  EPD_INTL: {
    code: 'EPD_INTL',
    tier: 1,
    label: 'Internationale EPD / LCA-database',
    short: 'EPD (intl.)',
    description: 'Geverifieerde EPD uit een buitenlands programma of een dataset uit een erkende databank (bv. Ecoinvent). Toegelaten, maar het resultaat draagt een vlag.',
    requiresNumber: true,
    verdict: 'VALID_WITH_WARNINGS',
  },
  SECTOR_GENERIC: {
    code: 'SECTOR_GENERIC',
    tier: 2,
    label: 'Generieke sectorwaarde',
    short: 'Sector',
    description: 'Door de sectorfederatie vastgelegde gemiddelde waarde. Bruikbaar in de ontwerpfase, nooit als productspecifieke declaratie.',
    requiresNumber: false,
    verdict: 'INDICATIVE',
  },
  SELF_DECLARED: {
    code: 'SELF_DECLARED',
    tier: 3,
    label: 'Eigen opgave (niet geverifieerd)',
    short: 'Eigen opgave',
    description: 'Waarde ingegeven zonder externe verificatie, bv. voor een proefreceptuur. De berekening loopt door maar het eindresultaat is ongeldig.',
    requiresNumber: false,
    verdict: 'INVALID',
  },
};

export const EVIDENCE_TYPE_CODES = Object.keys(EVIDENCE_TYPES);

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Verdict severity ladder. A result rolls up to the *worst* verdict found
 * anywhere in its inputs - one missing BEPD invalidates the whole dossier.
 */
export const VERDICTS = {
  VALID: { code: 'VALID', severity: 0, label: 'Geldig', tone: 'ok', description: 'Alle inputs zijn BEPD-gedekt en geldig op de referentiedatum.' },
  VALID_WITH_WARNINGS: { code: 'VALID_WITH_WARNINGS', severity: 1, label: 'Geldig met opmerking', tone: 'warn', description: 'Bruikbaar, maar minstens één input steunt op een internationale EPD in plaats van een BEPD.' },
  INDICATIVE: { code: 'INDICATIVE', severity: 2, label: 'Indicatief', tone: 'warn', description: 'Bevat generieke sectorwaarden. Enkel bruikbaar voor ontwerpramingen, niet als productdeclaratie.' },
  INVALID: { code: 'INVALID', severity: 3, label: 'Ongeldig', tone: 'bad', description: 'Minstens één input mist geldig bewijs. Het rekenresultaat heeft geen juridische waarde.' },
};

export const VERDICT_CODES = Object.keys(VERDICTS);

/** Roll a list of verdicts up to the worst one present. */
export function worstVerdict(verdicts) {
  let worst = 'VALID';
  for (const v of verdicts) {
    if (!v) continue;
    if (VERDICTS[v] && VERDICTS[v].severity > VERDICTS[worst].severity) worst = v;
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Workflow states                                                     */
/* ------------------------------------------------------------------ */

export const VERSION_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
};

export const DECLARATION_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_VERIFICATION: 'UNDER_VERIFICATION',
  VERIFIED: 'VERIFIED',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  AUTO_ACCEPTED: 'AUTO_ACCEPTED',
};

export const DECLARATION_STATUS_LABELS = {
  DRAFT: 'Ontwerp',
  SUBMITTED: 'Ingediend',
  UNDER_VERIFICATION: 'In verificatie',
  VERIFIED: 'Geverifieerd',
  PUBLISHED: 'Gepubliceerd',
  REJECTED: 'Afgekeurd',
  EXPIRED: 'Vervallen',
  AUTO_ACCEPTED: 'Automatisch aanvaard (bypass)',
};

export const ACCESS_STATUS = {
  PENDING: 'PENDING',
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  REVOKED: 'REVOKED',
};

export const GATE_DECISIONS = {
  GO: 'GO',
  GO_WITH_WARNING: 'GO_WITH_WARNING',
  NO_GO: 'NO_GO',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
};

/* ------------------------------------------------------------------ */
/* Plant & site process parameters                                     */
/* ------------------------------------------------------------------ */

/**
 * Parameters that drive module A3 (plant) and A5 (site). Each one has a
 * sector default; a producer may override it but only with a justification,
 * which is exactly what the external verifier audits.
 */
export const PARAMETER_DEFS = [
  { code: 'PLANT_ELECTRICITY', module: 'A3', label: 'Elektriciteit menginstallatie', unit: 'kWh/m³', factor: 'ELECTRICITY_BE' },
  { code: 'PLANT_DIESEL', module: 'A3', label: 'Dieselverbruik (wiellader, intern transport)', unit: 'l/m³', factor: 'DIESEL' },
  { code: 'PLANT_WATER', module: 'A3', label: 'Proceswater', unit: 'l/m³', factor: 'WATER_SUPPLY' },
  { code: 'PLANT_LOSS_PCT', module: 'A3', label: 'Productieverlies', unit: '%', factor: null },
  { code: 'SITE_PUMP_ELECTRICITY', module: 'A5', label: 'Energie pomp / kraan', unit: 'kWh/m³', factor: 'ELECTRICITY_BE' },
  { code: 'SITE_VIBRATION_ELECTRICITY', module: 'A5', label: 'Energie verdichting (trilnaald)', unit: 'kWh/m³', factor: 'ELECTRICITY_BE' },
  { code: 'SITE_FORMWORK', module: 'A5', label: 'Bekisting (toegerekend)', unit: 'm²/m³', factor: 'FORMWORK' },
  { code: 'SITE_WASTE_PCT', module: 'A5', label: 'Verlies op de werf', unit: '%', factor: null },
];

export const PARAMETER_BY_CODE = Object.fromEntries(PARAMETER_DEFS.map((p) => [p.code, p]));

/* ------------------------------------------------------------------ */
/* Change-control defaults (the "bypass" rules)                        */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS = {
  /** Single-change tolerance: below this, a new recipe version inherits verification. */
  bypass_tolerance_pct: '3',
  /** Cumulative drift since the last full verification. Stops salami-slicing. */
  bypass_cumulative_pct: '7.5',
  /** Maximum number of consecutive bypasses before a full verification is forced. */
  bypass_max_consecutive: '5',
  /** Months a verified declaration stays valid. */
  declaration_validity_months: '60',
  /** Deviation between the declared and the delivered recipe that still gets a GO. */
  delivery_tolerance_pct: '3',
};
