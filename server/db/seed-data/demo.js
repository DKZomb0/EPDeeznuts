/**
 * Demo dataset.
 *
 * It is built to walk through the whole argument in one sitting:
 *
 *  - a canal-side plant whose sand arrives by barge and an inland plant whose
 *    sand arrives by lorry, so the same strength class lands hundreds of kilos
 *    of CO2 apart. That gap is the reason plant-specific A2 has to exist.
 *  - one recipe that is fully BEPD-backed and publishable,
 *    one that leans on an international EPD and comes out flagged,
 *    one that uses a self-declared pigment and comes out void.
 *  - a recipe version history where a small change inherits its verification
 *    and a larger one is pushed back to the verifier.
 *  - a pending access request, because a producer cannot simply read a cement
 *    supplier's declarations without asking.
 *
 * Environmental values are illustrative but realistic in magnitude. The
 * non-GWP indicators are derived from per-family shape profiles rather than
 * invented one by one: for a demo that is honest, and every one of them is
 * replaced by a real BEPD the moment a supplier uploads one.
 */
import { INDICATOR_CODES } from '../../domain/constants.js';

/**
 * Ratios of each indicator to GWP-total, per material family. Derived from the
 * published EPDs the sector already works with.
 */
const SHAPES = {
  // Clinker-dominated: high fossil energy, high acidification.
  CEMENT: { GWP_FOSSIL: 0.995, GWP_BIOGENIC: 0.003, GWP_LULUC: 0.002, ODP: 2.4e-9, AP: 2.1e-3, EP_FRESHWATER: 3.1e-6, EP_MARINE: 6.8e-4, EP_TERRESTRIAL: 7.6e-3, POCP: 1.9e-3, ADPE: 1.1e-7, ADPF: 4.1, WDP: 0.021, PENRT: 4.6, PERT: 0.28 },
  // Quarried and washed: transport and diesel dominate a small absolute number.
  MINERAL: { GWP_FOSSIL: 0.99, GWP_BIOGENIC: 0.006, GWP_LULUC: 0.004, ODP: 4.1e-9, AP: 5.4e-3, EP_FRESHWATER: 8.2e-6, EP_MARINE: 1.6e-3, EP_TERRESTRIAL: 1.8e-2, POCP: 4.6e-3, ADPE: 2.6e-7, ADPF: 12.4, WDP: 0.11, PENRT: 13.1, PERT: 0.62 },
  // Ground granulated slag: almost entirely grinding electricity.
  GROUND: { GWP_FOSSIL: 0.988, GWP_BIOGENIC: 0.008, GWP_LULUC: 0.004, ODP: 5.0e-9, AP: 3.6e-3, EP_FRESHWATER: 1.4e-5, EP_MARINE: 8.9e-4, EP_TERRESTRIAL: 9.4e-3, POCP: 2.0e-3, ADPE: 1.4e-6, ADPF: 12.9, WDP: 0.10, PENRT: 14.2, PERT: 3.4 },
  // Petrochemical: fossil resource depletion dominates.
  CHEMICAL: { GWP_FOSSIL: 0.97, GWP_BIOGENIC: 0.02, GWP_LULUC: 0.01, ODP: 1.6e-8, AP: 4.2e-3, EP_FRESHWATER: 2.1e-5, EP_MARINE: 1.1e-3, EP_TERRESTRIAL: 1.2e-2, POCP: 3.4e-3, ADPE: 3.1e-6, ADPF: 21.6, WDP: 0.19, PENRT: 24.8, PERT: 1.1 },
  // Tap water: everything is tiny and driven by pumping electricity.
  WATER: { GWP_FOSSIL: 0.96, GWP_BIOGENIC: 0.03, GWP_LULUC: 0.01, ODP: 5.2e-8, AP: 4.5e-3, EP_FRESHWATER: 2.9e-5, EP_MARINE: 1.1e-3, EP_TERRESTRIAL: 1.2e-2, POCP: 2.4e-3, ADPE: 1.9e-6, ADPF: 14.2, WDP: 2.97, PENRT: 15.8, PERT: 2.9 },
};

/** Expand a GWP-total figure into the full indicator vector for its family. */
export function vectorFor(gwpTotal, family) {
  const shape = SHAPES[family] ?? SHAPES.MINERAL;
  const out = {};
  for (const code of INDICATOR_CODES) {
    if (code === 'GWP_TOTAL') out[code] = gwpTotal;
    else out[code] = gwpTotal * (shape[code] ?? 0);
  }
  return out;
}

/** Shorthand: { A1, A2, A3 } GWP figures -> the full per-module value map. */
export function modules({ A1 = 0, A2 = 0, A3 = 0 }, family) {
  const out = {};
  if (A1) out.A1 = vectorFor(A1, family);
  if (A2) out.A2 = vectorFor(A2, family);
  if (A3) out.A3 = vectorFor(A3, family);
  return out;
}

export const PASSWORD = 'demo1234';

/* ------------------------------------------------------------------ */
/* Organisations and their people                                      */
/* ------------------------------------------------------------------ */

export const ORGANISATIONS = [
  {
    key: 'heidelberg',
    name: 'Heidelberg Materials Benelux',
    type: 'SUPPLIER',
    vat: 'BE 0400.123.456',
    city: 'Antwerpen',
    sites: [{ key: 'hb_antwerpen', name: 'Cementmaalinstallatie Antwerpen', city: 'Antwerpen', note: 'Maalinstallatie aan het Albertkanaal.' }],
    users: [{ name: 'Katrien Buelens', email: 'katrien@heidelberg.demo', role: 'ADMIN' }],
  },
  {
    key: 'sagrex',
    name: 'Sagrex Granulaten',
    type: 'SUPPLIER',
    vat: 'BE 0401.222.333',
    city: 'Lanaye',
    sites: [
      { key: 'sx_kallo', name: 'Zandwinning Kallo', city: 'Kallo', note: 'Winning en wassing, verscheping via de Schelde.' },
      { key: 'sx_lanaye', name: 'Steengroeve Lanaye', city: 'Lanaye', note: 'Kalksteengroeve aan de Maas.' },
    ],
    users: [{ name: 'Dirk Cools', email: 'dirk@sagrex.demo', role: 'EDITOR' }],
  },
  {
    key: 'ecocem',
    name: 'Ecocem Benelux',
    type: 'SUPPLIER',
    vat: 'BE 0402.333.444',
    city: 'Moerdijk',
    sites: [{ key: 'ec_moerdijk', name: 'Maalinstallatie Moerdijk', city: 'Moerdijk', country: 'NL' }],
    users: [{ name: 'Sofie Peeters', email: 'sofie@ecocem.demo', role: 'EDITOR' }],
  },
  {
    key: 'chryso',
    name: 'Chryso Additives Belgium',
    type: 'SUPPLIER',
    vat: 'BE 0403.444.555',
    city: 'Vilvoorde',
    sites: [{ key: 'ch_vilvoorde', name: 'Productie Vilvoorde', city: 'Vilvoorde' }],
    users: [{ name: 'Marc Segers', email: 'marc@chryso.demo', role: 'EDITOR' }],
  },
  {
    key: 'pigment',
    name: 'Kremer Pigmenten',
    type: 'SUPPLIER',
    vat: 'DE 812.345.678',
    city: 'Aichstetten',
    country: 'DE',
    sites: [{ key: 'pg_aichstetten', name: 'Productie Aichstetten', city: 'Aichstetten', country: 'DE' }],
    users: [{ name: 'Anja Weber', email: 'anja@kremer.demo', role: 'EDITOR' }],
  },
  {
    key: 'watergroep',
    name: 'De Watergroep',
    type: 'SUPPLIER',
    vat: 'BE 0224.771.467',
    city: 'Brussel',
    sites: [{ key: 'wg_vlaanderen', name: 'Distributienet Vlaanderen', city: 'Brussel' }],
    users: [{ name: 'Tom Devos', email: 'tom@watergroep.demo', role: 'VIEWER' }],
  },
  {
    key: 'schelde',
    name: 'Betoncentrale De Schelde',
    type: 'PRODUCER',
    vat: 'BE 0450.111.222',
    city: 'Gent',
    sites: [
      { key: 'bs_gent', name: 'Centrale Gent-Zeehaven', city: 'Gent', note: 'Eigen kaaimuur: zand en grind komen per binnenschip toe.' },
    ],
    users: [
      { name: 'Lars Vermeulen', email: 'lars@deschelde.demo', role: 'ADMIN' },
      { name: 'Nele Aerts', email: 'nele@deschelde.demo', role: 'EDITOR' },
    ],
  },
  {
    key: 'vandenberghe',
    name: 'Beton Vandenberghe',
    type: 'PRODUCER',
    vat: 'BE 0451.333.444',
    city: 'Tielt',
    sites: [{ key: 'bv_tielt', name: 'Centrale Tielt', city: 'Tielt', note: 'Binnenlandse centrale, alle aanvoer over de weg.' }],
    users: [{ name: 'Peter Vandenberghe', email: 'peter@vandenberghe.demo', role: 'ADMIN' }],
  },
  {
    key: 'verhoeven',
    name: 'Aannemingen Verhoeven',
    type: 'CONTRACTOR',
    vat: 'BE 0460.555.666',
    city: 'Gent',
    sites: [],
    users: [{ name: 'Jonas Verhoeven', email: 'jonas@verhoeven.demo', role: 'ADMIN' }],
  },
  {
    key: 'certibeton',
    name: 'Certibeton Verificatie',
    type: 'VERIFIER',
    vat: 'BE 0470.777.888',
    city: 'Leuven',
    sites: [],
    users: [{ name: 'Ilse Maes', email: 'ilse@certibeton.demo', role: 'ADMIN' }],
  },
  {
    key: 'federatie',
    name: 'Federatie van de Betonindustrie',
    type: 'FEDERATION',
    vat: 'BE 0480.888.999',
    city: 'Brussel',
    sites: [],
    users: [{ name: 'Bart Claes', email: 'bart@betonfederatie.demo', role: 'ADMIN' }],
  },
  {
    key: 'overheid',
    name: 'FOD Economie — Kwaliteit en Veiligheid',
    type: 'REGULATOR',
    city: 'Brussel',
    sites: [],
    users: [{ name: 'Hilde Janssens', email: 'hilde@fod.demo', role: 'VIEWER' }],
  },
];

/* ------------------------------------------------------------------ */
/* Raw materials                                                       */
/* ------------------------------------------------------------------ */

/**
 * `evidence.type` is what drives the whole verdict chain, so the set below
 * covers every tier on purpose:
 *   BEPD           - the normal, publishable case
 *   EPD_INTL       - a real declaration from a foreign programme: usable, flagged
 *   SELF_DECLARED  - a trial pigment with no verification at all: void
 */
export const MATERIALS = [
  {
    key: 'cem1',
    org: 'heidelberg',
    site: 'hb_antwerpen',
    code: 'CEM I 42,5 N',
    name: 'Portlandcement CEM I 42,5 N',
    category: 'CEMENT',
    family: 'CEMENT',
    evidence: { type: 'BEPD', number: 'BEPD-2025-CEM-0114', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-03-01', valid_until: '2030-03-01' },
    values: { A1: 762, A2: 14, A3: 24 },
  },
  {
    key: 'cem3',
    org: 'heidelberg',
    site: 'hb_antwerpen',
    code: 'CEM III/A 42,5 N LA',
    name: 'Hoogovencement CEM III/A 42,5 N LA',
    category: 'CEMENT',
    family: 'CEMENT',
    evidence: { type: 'BEPD', number: 'BEPD-2025-CEM-0118', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-03-01', valid_until: '2030-03-01' },
    values: { A1: 372, A2: 21, A3: 28 },
    note: 'Ongeveer de helft van de klinker vervangen door hoogovenslak.',
  },
  {
    // Een echte verklaring, maar uit een buitenlands programma. Bruikbaar,
    // gemerkt, en nooit vatbaar voor de automatische bandbreedte.
    key: 'cem_intl',
    org: 'heidelberg',
    site: 'hb_antwerpen',
    code: 'CEM I 52,5 R',
    name: 'Portlandcement CEM I 52,5 R (Lixhe)',
    category: 'CEMENT',
    family: 'CEMENT',
    evidence: {
      type: 'EPD_INTL',
      number: 'EPD-NORW-2024-0517',
      programme: 'EPD Norge / ecoinvent 3.10',
      issuer: 'EPD Norge',
      valid_from: '2024-05-01',
      valid_until: '2029-05-01',
      note: 'Nog geen Belgische BEPD voor deze productielijn.',
    },
    values: { A1: 798, A2: 16, A3: 27 },
  },
  {
    // Geen verificatie: de proefreceptuur rekent door en komt er ongeldig uit.
    key: 'cem_pilot',
    org: 'ecocem',
    site: 'ec_moerdijk',
    code: 'ACT-PILOT',
    name: 'Klinkerarm bindmiddel ACT (proef)',
    category: 'CEMENT',
    family: 'CEMENT',
    evidence: {
      type: 'SELF_DECLARED',
      number: null,
      programme: null,
      issuer: null,
      valid_from: '2026-02-01',
      valid_until: null,
      note: 'Eigen LCA op proefproductie, nog niet extern geverifieerd.',
    },
    values: { A1: 168, A2: 19, A3: 41 },
  },
  {
    key: 'zand',
    org: 'sagrex',
    site: 'sx_kallo',
    code: 'ZAND 0/4',
    name: 'Gewassen betonzand 0/4',
    category: 'AGGREGATE_FINE',
    family: 'MINERAL',
    evidence: { type: 'BEPD', number: 'BEPD-2025-GRA-0042', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-01-15', valid_until: '2030-01-15' },
    values: { A1: 2.1, A2: 1.2, A3: 0.9 },
  },
  {
    key: 'grind',
    org: 'sagrex',
    site: 'sx_lanaye',
    code: 'GRIND 4/14',
    name: 'Gebroken kalksteen 4/14',
    category: 'AGGREGATE_COARSE',
    family: 'MINERAL',
    evidence: { type: 'BEPD', number: 'BEPD-2025-GRA-0047', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-01-15', valid_until: '2030-01-15' },
    values: { A1: 2.8, A2: 1.6, A3: 1.1 },
  },
  {
    key: 'ggbs',
    org: 'ecocem',
    site: 'ec_moerdijk',
    code: 'GGBS 4500',
    name: 'Gemalen hoogovenslak GGBS 4500',
    category: 'ADDITION',
    family: 'GROUND',
    evidence: { type: 'BEPD', number: 'BEPD-2025-ADD-0009', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-06-01', valid_until: '2030-06-01' },
    values: { A1: 22, A2: 17, A3: 46 },
    note: 'Toerekening als nevenproduct volgens EN 15167.',
  },
  {
    key: 'sp_bepd',
    org: 'chryso',
    site: 'ch_vilvoorde',
    code: 'OPTIMA 208',
    name: 'Superplastificeerder Optima 208',
    category: 'ADMIXTURE',
    family: 'CHEMICAL',
    evidence: { type: 'BEPD', number: 'BEPD-2025-ADM-0021', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-04-01', valid_until: '2030-04-01' },
    values: { A1: 1180, A2: 96, A3: 184 },
  },
  {
    key: 'sp_intl',
    org: 'chryso',
    site: 'ch_vilvoorde',
    code: 'PREMIA 180',
    name: 'Superplastificeerder Premia 180',
    category: 'ADMIXTURE',
    family: 'CHEMICAL',
    // A genuine, verified declaration - just not a Belgian one. Usable, but the
    // dossier that leans on it can never be published as a BEPD.
    evidence: { type: 'EPD_INTL', number: 'EFCA-PCE-2023-004', programme: 'EFCA sector-EPD (IBU)', issuer: 'IBU e.V.', valid_from: '2023-09-01', valid_until: '2028-09-01' },
    values: { A1: 1240, A2: 110, A3: 205 },
    note: 'Europese sector-EPD voor PCE-superplastificeerders, nog niet omgezet naar een BEPD.',
  },
  {
    key: 'pigment_rood',
    org: 'pigment',
    site: 'pg_aichstetten',
    code: 'FE-ROOD-130',
    name: 'IJzeroxidepigment rood 130',
    category: 'PIGMENT',
    family: 'CHEMICAL',
    // No verification at all: the calculation still runs, the result is void.
    evidence: { type: 'SELF_DECLARED', number: null, programme: null, issuer: null, valid_from: '2026-01-01', valid_until: null, note: 'Eigen LCA van de producent, nog niet extern geverifieerd.' },
    values: { A1: 2850, A2: 210, A3: 340 },
  },
  {
    key: 'water',
    org: 'watergroep',
    site: 'wg_vlaanderen',
    code: 'AANMAAKWATER',
    name: 'Aanmaakwater (leidingwater)',
    category: 'WATER',
    family: 'WATER',
    evidence: { type: 'BEPD', number: 'BEPD-2025-WAT-0003', programme: 'BEPD (federale databank)', issuer: 'Certibeton Verificatie', valid_from: '2025-02-01', valid_until: '2030-02-01' },
    values: { A1: 0.21, A2: 0.02, A3: 0.08 },
    includesInboundTransport: true, // delivered through the mains: no lorry leg
  },
];

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

/**
 * De Schelde sits on a quay, so its aggregates arrive by barge over a long
 * distance at a low factor. Vandenberghe is inland and hauls the same material
 * by lorry. Same strength class, very different A2 - and with CEM I instead of
 * CEM III/A, a very different A1 as well.
 */
export const RECIPES = [
  {
    key: 'schelde_c3037',
    org: 'schelde',
    site: 'bs_gent',
    code: 'C30/37-EE3-S4',
    name: 'Standaard buitenbeton C30/37',
    strength_class: 'C30/37',
    exposure_classes: 'EE3',
    consistency: 'S4',
    dmax: 14,
    density: 2350,
    benor: 1,
    components: [
      { material: 'cem3', quantityKg: 320, transportKm: 18, profile: 'TRUCK_32T' },
      { material: 'zand', quantityKg: 745, transportKm: 62, profile: 'INLAND_SHIP' },
      { material: 'grind', quantityKg: 1040, transportKm: 118, profile: 'INLAND_SHIP' },
      { material: 'water', quantityKg: 158, transportKm: 0, profile: null },
      { material: 'sp_bepd', quantityKg: 2.4, transportKm: 74, profile: 'TRUCK_16T' },
    ],
    // The flagship dossier: fully BEPD-backed, verified and published.
    lifecycle: 'PUBLISHED_WITH_HISTORY',
  },
  {
    key: 'schelde_lowco2',
    org: 'schelde',
    site: 'bs_gent',
    code: 'C30/37-EE3-LC',
    name: 'Laag-CO₂ beton C30/37 (klinkerarm)',
    strength_class: 'C30/37',
    exposure_classes: 'EE3',
    consistency: 'S4',
    dmax: 14,
    density: 2350,
    benor: 1,
    components: [
      { material: 'cem3', quantityKg: 200, transportKm: 18, profile: 'TRUCK_32T' },
      { material: 'ggbs', quantityKg: 140, transportKm: 96, profile: 'INLAND_SHIP' },
      { material: 'zand', quantityKg: 730, transportKm: 62, profile: 'INLAND_SHIP' },
      { material: 'grind', quantityKg: 1030, transportKm: 118, profile: 'INLAND_SHIP' },
      { material: 'water', quantityKg: 155, transportKm: 0, profile: null },
      { material: 'sp_bepd', quantityKg: 3.1, transportKm: 74, profile: 'TRUCK_16T' },
    ],
    lifecycle: 'PUBLISHED',
  },
  {
    key: 'schelde_c2530',
    org: 'schelde',
    site: 'bs_gent',
    code: 'C25/30-EE1-S3',
    name: 'Binnenbeton C25/30',
    strength_class: 'C25/30',
    exposure_classes: 'EE1',
    consistency: 'S3',
    dmax: 14,
    density: 2340,
    benor: 1,
    components: [
      { material: 'cem3', quantityKg: 290, transportKm: 18, profile: 'TRUCK_32T' },
      { material: 'zand', quantityKg: 760, transportKm: 62, profile: 'INLAND_SHIP' },
      { material: 'grind', quantityKg: 1050, transportKm: 118, profile: 'INLAND_SHIP' },
      { material: 'water', quantityKg: 162, transportKm: 0, profile: null },
      // The international EPD lands here: the dossier calculates, but comes out
      // flagged and can never be published as a BEPD.
      { material: 'sp_intl', quantityKg: 2.1, transportKm: 74, profile: 'TRUCK_16T' },
    ],
    lifecycle: 'SUBMITTED',
  },
  {
    key: 'schelde_zicht',
    org: 'schelde',
    site: 'bs_gent',
    code: 'C35/45-EE4-ROOD',
    name: 'Zichtbeton rood C35/45 (proefreceptuur)',
    strength_class: 'C35/45',
    exposure_classes: 'EE4',
    consistency: 'S4',
    dmax: 14,
    density: 2360,
    benor: 0,
    components: [
      { material: 'cem1', quantityKg: 380, transportKm: 18, profile: 'TRUCK_32T' },
      { material: 'zand', quantityKg: 700, transportKm: 62, profile: 'INLAND_SHIP' },
      { material: 'grind', quantityKg: 1010, transportKm: 118, profile: 'INLAND_SHIP' },
      { material: 'water', quantityKg: 152, transportKm: 0, profile: null },
      { material: 'sp_bepd', quantityKg: 3.4, transportKm: 74, profile: 'TRUCK_16T' },
      // Self-declared: this is what makes the whole result void.
      { material: 'pigment_rood', quantityKg: 19, transportKm: 640, profile: 'TRUCK_16T' },
    ],
    lifecycle: 'DRAFT',
  },
  {
    key: 'vdb_c3037',
    org: 'vandenberghe',
    site: 'bv_tielt',
    code: 'C30/37-EE3',
    name: 'Standaard buitenbeton C30/37',
    strength_class: 'C30/37',
    exposure_classes: 'EE3',
    consistency: 'S4',
    dmax: 14,
    density: 2350,
    benor: 1,
    components: [
      // CEM I instead of slag cement, and everything by lorry: the same class of
      // concrete, roughly double the footprint.
      { material: 'cem1', quantityKg: 335, transportKm: 78, profile: 'TRUCK_32T' },
      { material: 'zand', quantityKg: 750, transportKm: 92, profile: 'TRUCK_32T' },
      { material: 'grind', quantityKg: 1035, transportKm: 145, profile: 'TRUCK_32T' },
      { material: 'water', quantityKg: 160, transportKm: 0, profile: null },
      { material: 'sp_bepd', quantityKg: 2.2, transportKm: 96, profile: 'TRUCK_16T' },
    ],
    lifecycle: 'PUBLISHED',
  },
];

/* ------------------------------------------------------------------ */
/* Data sharing                                                        */
/* ------------------------------------------------------------------ */

export const ACCESS = [
  { requester: 'schelde', owner: 'heidelberg', status: 'GRANTED', reason: 'Vaste cementleverancier sinds 2019, contractnummer HB-2019-114.' },
  { requester: 'schelde', owner: 'sagrex', status: 'GRANTED', reason: 'Leveringen zand en grind via de Schelde.' },
  { requester: 'schelde', owner: 'ecocem', status: 'GRANTED', reason: 'GGBS voor klinkerarme receptuur.' },
  { requester: 'schelde', owner: 'chryso', status: 'GRANTED', reason: 'Hulpstoffen, raamcontract 2024-2027.' },
  { requester: 'schelde', owner: 'pigment', status: 'GRANTED', reason: 'Proefreceptuur zichtbeton.' },
  { requester: 'schelde', owner: 'watergroep', status: 'GRANTED', reason: 'Aanmaakwater.' },
  { requester: 'vandenberghe', owner: 'sagrex', status: 'GRANTED', reason: 'Granulaten via wegtransport.' },
  { requester: 'vandenberghe', owner: 'chryso', status: 'GRANTED', reason: 'Hulpstoffen.' },
  { requester: 'vandenberghe', owner: 'watergroep', status: 'GRANTED', reason: 'Aanmaakwater.' },
  // Left pending on purpose: the supplier still has to press a button.
  { requester: 'vandenberghe', owner: 'heidelberg', status: 'PENDING', reason: 'Wij starten in maart een levering CEM I 42,5 N en hebben de milieuparameters nodig voor onze declaratie.' },
];

/* ------------------------------------------------------------------ */
/* Projects and deliveries                                             */
/* ------------------------------------------------------------------ */

export const PROJECTS = [
  {
    key: 'dokken',
    org: 'verhoeven',
    name: 'Woonproject Nieuwe Dokken',
    reference: 'VH-2026-014',
    address: 'Koopvaardijlaan 40',
    city: 'Gent',
    architect: 'Architectenbureau De Vlaeminck',
    // The producer delivers with its own mixers, so A4 sits with the producer
    // and only A5 with the contractor.
    responsibilities: { A4: 'schelde', A5: 'verhoeven' },
    deliveries: [
      { recipe: 'schelde_c3037', volumeM3: 42, daysAgo: 26, distanceKm: 23, note: 'BON-2026-4411', profile: 'MIXER_8M3' },
      { recipe: 'schelde_c3037', volumeM3: 38, daysAgo: 19, distanceKm: 23, note: 'BON-2026-4478', profile: 'MIXER_8M3' },
      { recipe: 'schelde_lowco2', volumeM3: 54, daysAgo: 8, distanceKm: 23, note: 'BON-2026-4590', profile: 'MIXER_8M3' },
    ],
  },
  {
    key: 'bluegate',
    org: 'verhoeven',
    name: 'Kantoorgebouw Blue Gate',
    reference: 'VH-2026-021',
    address: 'Blue Gate Antwerp',
    city: 'Antwerpen',
    architect: 'Bureau Bovenbouw',
    // Here the contractor collects the concrete itself, so it carries A4 too.
    responsibilities: { A4: 'verhoeven', A5: 'verhoeven' },
    deliveries: [{ recipe: 'schelde_lowco2', volumeM3: 66, daysAgo: 4, distanceKm: 58, note: 'BON-2026-4612', profile: 'MIXER_12M3' }],
  },
  {
    // A second contractor's project supplied by the inland plant. Without it
    // every delivered cubic metre in the dataset would come from the canal-side
    // plant, and the volume-weighted sector average would be a portrait of one
    // producer rather than of the sector.
    key: 'leiespiegel',
    org: 'verhoeven',
    name: 'Woonerf Leiespiegel',
    reference: 'VH-2026-027',
    address: 'Deinsesteenweg 112',
    city: 'Tielt',
    architect: 'Studio Vandewalle',
    responsibilities: { A4: 'vandenberghe', A5: 'verhoeven' },
    deliveries: [
      { recipe: 'vdb_c3037', volumeM3: 78, daysAgo: 31, distanceKm: 14, note: 'BON-VDB-1187', profile: 'MIXER_8M3' },
      { recipe: 'vdb_c3037', volumeM3: 64, daysAgo: 17, distanceKm: 14, note: 'BON-VDB-1204', profile: 'MIXER_8M3' },
      { recipe: 'schelde_c3037', volumeM3: 45, daysAgo: 11, distanceKm: 47, note: 'BON-2026-4551', profile: 'MIXER_12M3' },
    ],
  },
];
