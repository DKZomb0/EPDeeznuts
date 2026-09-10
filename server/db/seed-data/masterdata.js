/**
 * Sector master data.
 *
 * These are the numbers the federation owns and every calculation refers back
 * to. They are versioned by `valid_from`, never overwritten, so a calculation
 * from last year keeps resolving last year's factor.
 *
 * The values below are realistic orders of magnitude drawn from published
 * transport and energy datasets, good enough to demonstrate and to argue about.
 * Before the platform carries a legally binding number, each row needs its own
 * agreed source reference - which is precisely why `source` is NOT NULL.
 */
import { INDICATOR_CODES } from '../../domain/constants.js';

/** Positional vector helper: values follow INDICATOR_CODES order. */
function vec(...values) {
  const out = {};
  INDICATOR_CODES.forEach((code, i) => {
    out[code] = values[i] ?? 0;
  });
  return out;
}

const VALID_FROM = '2026-01-01';

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export const TRANSPORT_PROFILES = [
  {
    code: 'TRUCK_32T',
    name: 'Vrachtwagen 32 t, EURO 6, incl. leegrit',
    mode: 'ROAD',
    payload_t: 24,
    empty_return: 1,
    source: 'Sectorafspraak op basis van EN 16258 / ecoinvent v3.10, lorry >32t EURO6',
    note: 'Standaardprofiel voor aanvoer van grondstoffen over de weg.',
    values: vec(0.0975, 0.0971, 0.00022, 0.00018, 2.1e-8, 4.6e-4, 1.1e-6, 1.6e-4, 1.8e-3, 4.4e-4, 5.0e-8, 1.32, 3.6e-3, 1.38, 0.021),
  },
  {
    code: 'TRUCK_16T',
    name: 'Vrachtwagen 16 t, EURO 6, incl. leegrit',
    mode: 'ROAD',
    payload_t: 10,
    empty_return: 1,
    source: 'Sectorafspraak op basis van EN 16258 / ecoinvent v3.10, lorry 16-32t EURO6',
    values: vec(0.155, 0.1544, 0.00035, 0.00028, 3.3e-8, 7.3e-4, 1.7e-6, 2.5e-4, 2.9e-3, 7.0e-4, 8.0e-8, 2.1, 5.7e-3, 2.19, 0.033),
  },
  {
    code: 'INLAND_SHIP',
    name: 'Binnenvaartschip 1 500 t',
    mode: 'INLAND_SHIP',
    payload_t: 1500,
    empty_return: 0,
    source: 'Sectorafspraak op basis van ecoinvent v3.10, barge transport RER',
    note: 'Voor centrales met een eigen kaaimuur. De belangrijkste reden waarom A2 plantspecifiek moet zijn.',
    values: vec(0.031, 0.0309, 0.00007, 0.00006, 6.7e-9, 4.9e-4, 3.5e-7, 1.4e-4, 1.6e-3, 3.8e-4, 1.6e-8, 0.42, 1.1e-3, 0.44, 0.007),
  },
  {
    code: 'RAIL_ELECTRIC',
    name: 'Spoorvervoer, elektrisch',
    mode: 'RAIL',
    payload_t: 1000,
    empty_return: 0,
    source: 'Sectorafspraak op basis van ecoinvent v3.10, freight train BE',
    values: vec(0.021, 0.0208, 0.00005, 0.00004, 4.4e-9, 8.0e-5, 4.2e-7, 2.4e-5, 2.6e-4, 6.4e-5, 1.1e-8, 0.31, 1.9e-3, 0.36, 0.09),
  },
  {
    code: 'MIXER_8M3',
    name: 'Betonmixer 8 m³, incl. trommelrotatie en leegrit',
    mode: 'MIXER',
    payload_t: 19,
    empty_return: 1,
    source: 'Sectorafspraak op basis van EN 16258, aangevuld met verbruiksmeting trommelaandrijving',
    note: 'Standaardprofiel voor module A4. Hoger dan een gewone vrachtwagen door de aandrijving van de trommel.',
    values: vec(0.132, 0.1314, 0.0003, 0.00024, 2.8e-8, 6.2e-4, 1.5e-6, 2.2e-4, 2.4e-3, 5.9e-4, 6.8e-8, 1.79, 4.9e-3, 1.87, 0.028),
  },
  {
    code: 'MIXER_12M3',
    name: 'Betonmixer 12 m³, incl. trommelrotatie en leegrit',
    mode: 'MIXER',
    payload_t: 28,
    empty_return: 1,
    source: 'Sectorafspraak op basis van EN 16258, aangevuld met verbruiksmeting trommelaandrijving',
    values: vec(0.108, 0.1075, 0.00025, 0.0002, 2.3e-8, 5.1e-4, 1.2e-6, 1.8e-4, 2.0e-3, 4.8e-4, 5.6e-8, 1.46, 4.0e-3, 1.53, 0.023),
  },
];

/* ------------------------------------------------------------------ */
/* Energy and ancillary factors                                        */
/* ------------------------------------------------------------------ */

export const ENERGY_FACTORS = [
  {
    code: 'ELECTRICITY_BE',
    name: 'Elektriciteit, Belgisch net (residual mix)',
    unit: 'kWh',
    source: 'Sectorafspraak op basis van AIB residual mix BE 2025',
    note: 'Een centrale met een gedekt groenestroomcontract mag deze waarde overschrijven, mits bewijs van herkomst.',
    values: vec(0.157, 0.1541, 0.0018, 0.0011, 8.2e-9, 5.9e-4, 2.4e-6, 1.4e-4, 1.5e-3, 3.1e-4, 2.4e-7, 2.05, 0.017, 2.31, 0.62),
  },
  {
    code: 'DIESEL',
    name: 'Diesel, verbrand in mobiele machine (incl. winning)',
    unit: 'l',
    source: 'Sectorafspraak op basis van ecoinvent v3.10, diesel burned in building machine',
    values: vec(3.24, 3.2298, 0.006, 0.0042, 6.4e-7, 0.0182, 3.2e-5, 0.0054, 0.0596, 0.0141, 1.6e-6, 45.6, 0.021, 47.8, 0.31),
  },
  {
    code: 'WATER_SUPPLY',
    name: 'Leidingwater, geleverd',
    unit: 'l',
    source: 'Sectorafspraak op basis van ecoinvent v3.10, tap water BE',
    values: vec(0.00031, 0.00030, 1.0e-6, 8.0e-7, 1.6e-11, 1.4e-6, 9.0e-9, 3.4e-7, 3.8e-6, 7.5e-7, 6.0e-10, 0.0044, 0.00092, 0.0049, 0.0009),
  },
  {
    code: 'FORMWORK',
    name: 'Bekisting, toegerekend per m² contactoppervlak',
    unit: 'm²',
    source: 'Sectorafspraak: multiplexbekisting, toegerekend over 20 hergebruiken',
    note: 'Vereenvoudigde toerekening. Een aannemer met een eigen systeembekisting mag dit overschrijven.',
    values: vec(1.18, 0.96, 0.19, 0.03, 1.1e-7, 0.0062, 2.1e-5, 0.0019, 0.021, 0.0048, 3.2e-7, 15.8, 0.048, 17.2, 4.9),
  },
];

/* ------------------------------------------------------------------ */
/* Generic process parameters                                          */
/* ------------------------------------------------------------------ */

export const PROCESS_DEFAULTS = [
  {
    code: 'PLANT_ELECTRICITY',
    value: 2.5,
    unit: 'kWh/m³',
    source: 'Sectorgemiddelde betoncentrales België, bevraging 2025',
    note: 'De generieke waarde waar een centrale op terugvalt als ze haar eigen verbruik niet meet.',
  },
  { code: 'PLANT_DIESEL', value: 0.55, unit: 'l/m³', source: 'Sectorgemiddelde betoncentrales België, bevraging 2025', note: 'Wiellader en intern transport.' },
  { code: 'PLANT_WATER', value: 25, unit: 'l/m³', source: 'Sectorgemiddelde betoncentrales België, bevraging 2025', note: 'Proces- en spoelwater bovenop het aanmaakwater in de receptuur.' },
  { code: 'PLANT_LOSS_PCT', value: 1.5, unit: '%', source: 'Sectorgemiddelde: retourbeton en spoelverlies', note: 'Opslag op A1-A3.' },
  { code: 'SITE_PUMP_ELECTRICITY', value: 1.2, unit: 'kWh/m³', source: 'Sectorafspraak werfverwerking, raming 2025' },
  { code: 'SITE_VIBRATION_ELECTRICITY', value: 0.35, unit: 'kWh/m³', source: 'Sectorafspraak werfverwerking, raming 2025', note: 'Trilnaald / verdichting.' },
  { code: 'SITE_FORMWORK', value: 3.0, unit: 'm²/m³', source: 'Sectorafspraak werfverwerking, raming 2025', note: 'Gemiddeld contactoppervlak per m³ voor courante constructiedelen.' },
  { code: 'SITE_WASTE_PCT', value: 2.0, unit: '%', source: 'Sectorafspraak werfverwerking, raming 2025', note: 'Opslag op A1-A4.' },
];

/* ------------------------------------------------------------------ */
/* Which modules each material category must declare                   */
/* ------------------------------------------------------------------ */

/**
 * European product rules decide how far each input has to declare. Cement stops
 * at A1-A3: its transport to the customer is the customer's A2, and requiring a
 * cement plant to certify A4/A5 would mean a new declaration for every single
 * destination.
 */
export const CATEGORY_RULES = [
  {
    category: 'CEMENT',
    required_modules: 'A1,A2,A3',
    optional_modules: 'A4,A5',
    source: 'EN 15804+A2 / EN 16908 (cement en kalk) - cradle to gate',
    note: 'A4-A5 zijn niet van toepassing: het transport naar de betoncentrale is de A2 van de betonproducent.',
  },
  { category: 'AGGREGATE_FINE', required_modules: 'A1,A2,A3', optional_modules: 'A4', source: 'EN 15804+A2 / EN 16578 (granulaten)', note: 'Winning, transport naar de breek- of wasinstallatie en de behandeling zelf.' },
  { category: 'AGGREGATE_COARSE', required_modules: 'A1,A2,A3', optional_modules: 'A4', source: 'EN 15804+A2 / EN 16578 (granulaten)' },
  { category: 'ADDITION', required_modules: 'A1,A2,A3', optional_modules: '', source: 'EN 15804+A2 / EN 15167 (gemalen hoogovenslak), EN 450 (vliegas)', note: 'Toerekening bij nevenproducten is het gevoeligste punt in deze categorie.' },
  { category: 'ADMIXTURE', required_modules: 'A1,A2,A3', optional_modules: '', source: 'EN 15804+A2 / EN 934, EFCA sector-EPD' },
  { category: 'WATER', required_modules: 'A1,A2,A3', optional_modules: '', source: 'EN 15804+A2', note: 'In veel receptuurberekeningen verwaarloosbaar, maar wel verplicht te rapporteren.' },
  { category: 'PIGMENT', required_modules: 'A1,A2,A3', optional_modules: '', source: 'EN 15804+A2' },
  { category: 'FIBRE', required_modules: 'A1,A2,A3', optional_modules: '', source: 'EN 15804+A2 / EN 14889' },
  { category: 'REINFORCEMENT', required_modules: 'A1,A2,A3', optional_modules: 'A4,A5', source: 'EN 15804+A2 / EN 10080' },
];

/* ------------------------------------------------------------------ */
/* Strength classes                                                    */
/* ------------------------------------------------------------------ */

export const STRENGTH_CLASSES = [
  ['C12/15', 'NORMAL', 12, 15],
  ['C16/20', 'NORMAL', 16, 20],
  ['C20/25', 'NORMAL', 20, 25],
  ['C25/30', 'NORMAL', 25, 30],
  ['C30/37', 'NORMAL', 30, 37],
  ['C35/45', 'NORMAL', 35, 45],
  ['C40/50', 'NORMAL', 40, 50],
  ['C45/55', 'NORMAL', 45, 55],
  ['C50/60', 'NORMAL', 50, 60],
  ['LC25/28', 'LIGHT', 25, 28],
  ['LC30/33', 'LIGHT', 30, 33],
].map(([code, family, fck_cyl, fck_cube], i) => ({ code, family, fck_cyl, fck_cube, sort: i }));

export { VALID_FROM };
