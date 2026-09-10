/**
 * Change control: when may a version inherit its predecessor's verification?
 *
 * These are the thresholds still being negotiated at Flemish level, so the
 * tests are written to document the intended behaviour rather than to freeze
 * particular numbers.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, teardown, userOf, activeVersionOf, recipeByCode } from './helpers.js';
import { evaluateChange, pctChange } from '../server/domain/changes.js';
import { createRecipeVersion, copyComponents, componentsOf } from '../server/domain/versioning.js';
import { submitDeclaration } from '../server/domain/declarations.js';

after(teardown);

const RECIPE = 'C30/37-EE3-LC';

async function newVersionWithCementDelta(deltaKg, reason = 'test') {
  const recipe = await recipeByCode(RECIPE);
  const actor = await userOf('Betoncentrale De Schelde');
  const current = await activeVersionOf(RECIPE);
  const components = await copyComponents(current.id);

  const cement = (await componentsOf(current.id)).find((c) => c.category === 'CEMENT');
  const adjusted = components.map((c) =>
    c.materialId === cement.material_id ? { ...c, quantityKg: c.quantityKg + deltaKg } : c,
  );

  return createRecipeVersion({ recipeId: recipe.id, components: adjusted, changeReason: reason, status: 'DRAFT' }, actor);
}

test('pctChange rekent correct en valt niet over een nul', () => {
  assert.equal(pctChange(100, 110), 10);
  assert.equal(pctChange(100, 90), -10);
  assert.equal(pctChange(0, 50), 0);
});

test('een kleine wijziging blijft binnen de marge en erft de verificatie', async () => {
  const version = await newVersionWithCementDelta(-3, 'Cementdosering licht verlaagd.');
  const gate = await evaluateChange(version.id);

  assert.equal(gate.decision, 'AUTO_ACCEPT', gate.summary);
  assert.ok(Math.abs(gate.deviationPct) <= gate.thresholds.tolerancePct);
  assert.ok(gate.checks.every((c) => c.passed));
});

test('een grote wijziging gaat terug naar de verificateur, met reden', async () => {
  const version = await newVersionWithCementDelta(-60, 'Sterke verlaging van de cementdosering.');
  const gate = await evaluateChange(version.id);

  assert.equal(gate.decision, 'REQUIRES_VERIFICATION');
  assert.ok(gate.blockedBy.includes('SINGLE_STEP'), `verwacht SINGLE_STEP, kreeg ${gate.blockedBy.join(', ')}`);
  assert.match(gate.summary, /verificatie/i);
});

test('elke toets legt haar eigen redenering vast', async () => {
  const version = await newVersionWithCementDelta(-2);
  const gate = await evaluateChange(version.id);

  const codes = gate.checks.map((c) => c.code);
  for (const expected of ['VERDICT_CLEAN', 'SINGLE_STEP', 'CUMULATIVE_DRIFT', 'CONSECUTIVE_BYPASSES', 'NO_NEW_MATERIAL']) {
    assert.ok(codes.includes(expected), `toets ${expected} ontbreekt`);
  }
  for (const check of gate.checks) assert.ok(check.message.length > 10, `toets ${check.code} mist een leesbare uitleg`);
});

test('de opgetelde drift sluit salamitactiek af', async () => {
  // Twintig stapjes van 2,5 % zijn samen een wijziging van 50 % die nooit een
  // verificateur zag. De cumulatieve grendel is precies daarvoor bedoeld.
  const actor = await userOf('Betoncentrale De Schelde');
  const recipe = await recipeByCode(RECIPE);

  let blocked = null;
  for (let step = 0; step < 12 && !blocked; step += 1) {
    const version = await newVersionWithCementDelta(-4 * (step + 1), `Stap ${step + 1}`);
    const gate = await evaluateChange(version.id);

    if (gate.decision === 'AUTO_ACCEPT') {
      await submitDeclaration({ recipeVersionId: version.id }, actor);
    } else if (gate.blockedBy.includes('CUMULATIVE_DRIFT')) {
      blocked = gate;
    }
  }

  assert.ok(blocked, 'de opgetelde drift hoort op een bepaald punt een volledige verificatie af te dwingen');
  assert.ok(Math.abs(blocked.cumulativePct) > blocked.thresholds.cumulativePct);
});

test('een dossier dat niet volledig BEPD-gedekt is, komt nooit door de bypass', async () => {
  const version = await activeVersionOf('C25/30-EE1-S3'); // leunt op een internationale EPD
  const gate = await evaluateChange(version.id);

  assert.equal(gate.decision, 'REQUIRES_VERIFICATION');
  assert.ok(gate.blockedBy.includes('VERDICT_CLEAN') || gate.blockedBy.includes('NO_PREVIOUS_DECLARATION'));
});

test('de allereerste versie van een receptuur gaat altijd door de verificatie', async () => {
  const actor = await userOf('Betoncentrale De Schelde');
  const { id } = await import('../server/lib/ids.js');
  const recipeId = id('rec');

  await db.run(
    `INSERT INTO recipes (id, org_id, site_id, code, name, strength_class, exposure_classes, consistency, dmax, density, benor, archived, created_at)
     VALUES (?, ?, NULL, 'TEST-NIEUW', 'Testreceptuur', 'C25/30', 'EE1', 'S3', 14, 2350, 0, 0, ?)`,
    [recipeId, actor.orgId, new Date().toISOString()],
  );

  const source = await activeVersionOf(RECIPE);
  const version = await createRecipeVersion(
    { recipeId, components: await copyComponents(source.id), changeReason: 'Initieel', status: 'DRAFT' },
    actor,
  );

  const gate = await evaluateChange(version.id);
  assert.equal(gate.decision, 'REQUIRES_VERIFICATION');
  assert.ok(gate.blockedBy.includes('NO_PREVIOUS_DECLARATION'));
});
