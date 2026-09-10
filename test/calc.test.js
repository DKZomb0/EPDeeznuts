/**
 * The calculation engine, against the seeded demo chain.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, teardown, activeVersionOf } from './helpers.js';
import { calculateRecipeVersion, declaredUnitKg, scale, emptyVector, addInto } from '../server/domain/calc.js';

after(teardown);

test('vector-rekenwerk', () => {
  assert.equal(declaredUnitKg('TONNE'), 1000);
  assert.equal(declaredUnitKg('KG'), 1);
  assert.equal(declaredUnitKg('M3', 2350), 2350, 'per m³ gedeclareerd heeft de densiteit nodig');
  assert.equal(declaredUnitKg('M3', null), 1000, 'zonder densiteit valt het terug op een ton');

  const doubled = scale({ GWP_TOTAL: 3 }, 2);
  assert.equal(doubled.GWP_TOTAL, 6);
  assert.equal(doubled.ODP, 0, 'ontbrekende indicatoren worden nul, niet undefined');

  const acc = emptyVector();
  addInto(acc, { GWP_TOTAL: 2 });
  addInto(acc, { GWP_TOTAL: 5 });
  assert.equal(acc.GWP_TOTAL, 7);
});

test('een volledig BEPD-gedekte receptuur levert een geldig resultaat', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id);

  assert.equal(result.verdict, 'VALID');
  assert.equal(result.scope, 'A1-A3');
  assert.ok(result.totals.GWP_TOTAL > 100 && result.totals.GWP_TOTAL < 250, `verwacht een realistische orde van grootte, kreeg ${result.totals.GWP_TOTAL}`);
});

test('de modules tellen op tot het totaal', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id);

  const sum = result.modules.reduce((s, m) => s + result.byModule[m].GWP_TOTAL, 0);
  assert.ok(Math.abs(sum - result.totals.GWP_TOTAL) < 1e-9);
});

test('de trace verklaart het volledige getal, term per term', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id);

  const traced = result.trace.reduce((s, line) => s + (line.values.GWP_TOTAL ?? 0), 0);
  assert.ok(Math.abs(traced - result.totals.GWP_TOTAL) < 1e-9, 'geen enkele bijdrage mag buiten de trace vallen');

  for (const line of result.trace) {
    assert.ok(line.formula, `regel "${line.label}" mist een formule`);
    assert.ok(line.label, 'elke regel heeft een leesbaar label nodig');
    assert.ok(line.factor, `regel "${line.label}" mist haar factor`);
  }
});

test('de wieg-tot-poort van de leverancier landt in A1, de aanvoer naar de centrale in A2', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id);

  const a1 = result.trace.filter((l) => l.module === 'A1');
  assert.ok(a1.some((l) => l.upstreamModule === 'A1'));
  assert.ok(a1.some((l) => l.upstreamModule === 'A2'), 'de A2 van de leverancier hoort in onze A1');
  assert.ok(a1.some((l) => l.upstreamModule === 'A3'));

  const a2 = result.trace.filter((l) => l.module === 'A2' && l.kind === 'TRANSPORT');
  assert.ok(a2.length > 0, 'de aanvoer naar de centrale hoort een eigen A2-term te zijn');
});

test('franco geleverde grondstoffen krijgen geen tweede transportterm', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id);

  const water = result.trace.find((l) => l.module === 'A2' && l.label.includes('Aanmaakwater'));
  assert.ok(water, 'ook een franco levering hoort zichtbaar te zijn in de trace');
  assert.equal(water.values.GWP_TOTAL, 0);
  assert.match(water.detail, /inbegrepen/i);
});

test('een niet-geverifieerde grondstof maakt het hele resultaat ongeldig', async () => {
  const version = await db.get(
    `SELECT rv.* FROM recipe_versions rv JOIN recipes r ON r.id = rv.recipe_id WHERE r.code = 'C35/45-EE4-ROOD' LIMIT 1`,
  );
  const result = await calculateRecipeVersion(version.id);

  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.totals.GWP_TOTAL > 0, 'de berekening loopt wel gewoon door');
  assert.ok(result.reasons.some((r) => r.code === 'EVIDENCE_SELF_DECLARED'));
});

test('een internationale EPD levert een bruikbaar maar gemerkt resultaat', async () => {
  const version = await activeVersionOf('C25/30-EE1-S3');
  const result = await calculateRecipeVersion(version.id);

  assert.equal(result.verdict, 'VALID_WITH_WARNINGS');
  assert.ok(result.reasons.some((r) => r.code === 'EVIDENCE_INTERNATIONAL'));
});

test('vervoer over water weegt veel lichter dan wegtransport over dezelfde afstand', async () => {
  const canal = await calculateRecipeVersion((await activeVersionOf('C30/37-EE3-S4')).id);
  const inland = await calculateRecipeVersion((await activeVersionOf('C30/37-EE3')).id);

  // Dezelfde sterkteklasse, andere centrale: dit verschil is precies waarom A2
  // plantspecifiek moet zijn in plaats van een sectorgemiddelde.
  assert.ok(
    inland.byModule.A2.GWP_TOTAL > canal.byModule.A2.GWP_TOTAL * 2,
    `verwacht een veel hogere A2 voor de binnenlandse centrale, kreeg ${inland.byModule.A2.GWP_TOTAL} vs ${canal.byModule.A2.GWP_TOTAL}`,
  );
});

test('A4 en A5 blijven leeg zolang er geen werf bekend is', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id, { scope: 'A1-A5' });

  assert.equal(result.byModule.A4.GWP_TOTAL, 0);
  assert.ok(result.reasons.some((r) => r.code === 'A4_NOT_SPECIFIED'));
  assert.equal(result.verdict, 'INDICATIVE', 'zonder werfgegevens is A1-A5 hoogstens indicatief');
});

test('met een werfafstand vult A4 zich op basis van de densiteit', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id, {
    scope: 'A1-A5',
    site: { distanceKm: 25, transportProfileId: 'MIXER_8M3' },
    volumeM3: 10,
  });

  assert.ok(result.byModule.A4.GWP_TOTAL > 0);
  assert.ok(Math.abs(result.absolute.GWP_TOTAL - result.totals.GWP_TOTAL * 10) < 1e-9);
});

test('de berekening verwijst naar de masterdata van haar referentiedatum', async () => {
  const version = await activeVersionOf('C30/37-EE3-S4');
  const result = await calculateRecipeVersion(version.id, { at: '2026-06-01T00:00:00.000Z' });
  assert.equal(result.referenceDate, '2026-06-01T00:00:00.000Z');
});
