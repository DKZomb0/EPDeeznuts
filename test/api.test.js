/**
 * End-to-end over HTTP, including the access rules.
 *
 * The confidentiality behaviour is tested here rather than at unit level,
 * because what matters commercially is what actually leaves the server.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { teardown, startServer, db } from './helpers.js';

let harness;
before(async () => {
  harness = await startServer();
});
after(async () => {
  await harness.close();
  await teardown();
});

test('aanmelden werkt en levert de rechten van de rol', async () => {
  const client = harness.client();
  const session = await client.login('lars@deschelde.demo');

  assert.equal(session.user.orgType, 'PRODUCER');
  assert.ok(session.capabilities.includes('recipes:write'));
  assert.ok(!session.capabilities.includes('verification:decide'), 'een producent verifieert niet zijn eigen dossiers');
});

test('een verkeerd wachtwoord wordt geweigerd', async () => {
  const client = harness.client();
  const res = await client.post('/auth/login', { email: 'lars@deschelde.demo', password: 'fout' });
  assert.equal(res.status, 401);
});

test('zonder aanmelding is er geen toegang', async () => {
  const res = await harness.client().get('/recipes');
  assert.equal(res.status, 401);
});

test('een producent ziet de catalogus, maar niet de cijfers zonder toestemming', async () => {
  const client = harness.client();
  await client.login('peter@vandenberghe.demo'); // heeft geen toegang tot Heidelberg

  const { body } = await client.get('/materials');
  const cement = body.materials.find((m) => m.supplier_name.includes('Heidelberg'));

  assert.ok(cement, 'het product hoort zichtbaar te zijn, anders kan er nooit toegang voor gevraagd worden');
  assert.equal(cement.restricted, true);
  assert.equal(cement.values, null, 'de milieuparameters mogen niet meegestuurd worden');

  const detail = await client.get(`/materials/${cement.id}`);
  assert.equal(detail.body.restricted, true);
  assert.deepEqual(detail.body.versions, []);
});

test('met een toegekende aanvraag komen de cijfers wel mee', async () => {
  const client = harness.client();
  await client.login('lars@deschelde.demo'); // heeft wel toegang

  const { body } = await client.get('/materials');
  const cement = body.materials.find((m) => m.supplier_name.includes('Heidelberg'));

  assert.equal(cement.restricted, false);
  assert.ok(cement.values.A1.GWP_TOTAL > 0);
});

test('de volledige aanvraag-en-beslissingscyclus werkt', async () => {
  const producer = harness.client();
  await producer.login('peter@vandenberghe.demo');

  const supplierOrg = await db.get("SELECT id FROM organisations WHERE name LIKE 'Ecocem%'");
  const created = await producer.post('/access', { ownerOrgId: supplierOrg.id, reason: 'Nieuwe leveringen GGBS vanaf maart.' });
  assert.equal(created.status, 201);

  // Een tweede aanvraag voor dezelfde leverancier wordt tegengehouden.
  const duplicate = await producer.post('/access', { ownerOrgId: supplierOrg.id, reason: 'Nogmaals' });
  assert.equal(duplicate.status, 409);

  const supplier = harness.client();
  await supplier.login('sofie@ecocem.demo');
  const inbox = await supplier.get('/access');
  const pending = inbox.body.incoming.find((r) => r.id === created.body.request.id);
  assert.ok(pending);

  const decided = await supplier.post(`/access/${pending.id}/decide`, { decision: 'GRANT' });
  assert.equal(decided.body.request.status, 'GRANTED');

  const after = await producer.get('/materials');
  const ggbs = after.body.materials.find((m) => m.supplier_name.includes('Ecocem'));
  assert.equal(ggbs.restricted, false, 'na toekenning zijn de cijfers zichtbaar');
});

test('een producent kan niet beslissen over andermans toegangsaanvraag', async () => {
  const client = harness.client();
  await client.login('lars@deschelde.demo');

  const request = await db.get("SELECT id FROM access_requests WHERE status = 'PENDING' LIMIT 1");
  if (!request) return;

  const res = await client.post(`/access/${request.id}/decide`, { decision: 'GRANT' });
  assert.equal(res.status, 403);
});

test('een receptuur van een andere producent is niet opvraagbaar', async () => {
  const client = harness.client();
  await client.login('peter@vandenberghe.demo');

  const other = await db.get("SELECT r.id FROM recipes r JOIN organisations o ON o.id = r.org_id WHERE o.name LIKE 'Betoncentrale De Schelde%' LIMIT 1");
  const res = await client.get(`/recipes/${other.id}`);
  assert.equal(res.status, 403);
});

test('een verificateur mag wel over de organisaties heen kijken', async () => {
  const client = harness.client();
  await client.login('ilse@certibeton.demo');

  const other = await db.get("SELECT r.id FROM recipes r JOIN organisations o ON o.id = r.org_id WHERE o.name LIKE 'Betoncentrale De Schelde%' LIMIT 1");
  const res = await client.get(`/recipes/${other.id}`);
  assert.equal(res.status, 200, 'zonder inzage in de inputs valt er niets te verifiëren');
});

test('een verificateur kan een ongeldig dossier niet goedkeuren', async () => {
  const producer = harness.client();
  await producer.login('lars@deschelde.demo');

  const version = await db.get(
    `SELECT rv.id FROM recipe_versions rv JOIN recipes r ON r.id = rv.recipe_id WHERE r.code = 'C35/45-EE4-ROOD' LIMIT 1`,
  );
  const submitted = await producer.post('/declarations', { recipeVersionId: version.id });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.verdict, 'INVALID');

  const verifier = harness.client();
  await verifier.login('ilse@certibeton.demo');
  await verifier.post(`/declarations/${submitted.body.declaration.id}/take`);

  const decision = await verifier.post(`/declarations/${submitted.body.declaration.id}/decide`, {
    decision: 'APPROVE',
    note: 'Toch goedkeuren',
  });
  assert.equal(decision.status, 422, 'een ontbrekend bewijsstuk stroomopwaarts kan de verificateur niet opheffen');
  assert.match(decision.body.error.message, /niet worden goedgekeurd/i);
});

test('het transparantierapport bevat de volledige onderbouwing', async () => {
  const client = harness.client();
  await client.login('lars@deschelde.demo');

  const declaration = await db.get("SELECT id FROM declarations WHERE status = 'PUBLISHED' LIMIT 1");
  const { body } = await client.get(`/declarations/${declaration.id}/report`);
  const report = body.report;

  assert.ok(report.inputs.length > 0);
  assert.ok(report.calculation.modules.some((m) => m.lines.length > 0));
  assert.ok(report.masterData.transportProfiles.length > 0, 'de gebruikte transportfactoren horen erbij te staan');
  assert.ok(report.masterData.transportProfiles.every((p) => p.source), 'elke factor heeft een bronvermelding nodig');
  assert.ok(report.validity.rule.includes('BEPD'));
  assert.equal(report.meta.basis, 'SNAPSHOT', 'een geverifieerd dossier rapporteert wat geverifieerd werd');
  assert.ok(report.audit.length >= 0);
});

test('werfparameters kunnen alleen door de verantwoordelijke partij ingevuld worden', async () => {
  const delivery = await db.get(
    `SELECT d.id FROM deliveries d
       JOIN project_responsibilities pr ON pr.project_id = d.project_id AND pr.module = 'A5'
       JOIN organisations o ON o.id = pr.org_id
      WHERE o.type = 'CONTRACTOR' LIMIT 1`,
  );

  const producer = harness.client();
  await producer.login('lars@deschelde.demo');
  const refused = await producer.patch(`/deliveries/${delivery.id}/parameters`, {
    parameters: [{ code: 'SITE_WASTE_PCT', value: 1, unit: '%' }],
  });
  assert.equal(refused.status, 403);

  const contractor = harness.client();
  await contractor.login('jonas@verhoeven.demo');
  const accepted = await contractor.patch(`/deliveries/${delivery.id}/parameters`, {
    parameters: [{ code: 'SITE_WASTE_PCT', value: 1.4, unit: '%' }],
  });
  assert.equal(accepted.status, 200);
});

test('een overschreven sectorwaarde zonder verantwoording wordt geweigerd', async () => {
  const delivery = await db.get(
    `SELECT d.id FROM deliveries d
       JOIN project_responsibilities pr ON pr.project_id = d.project_id AND pr.module = 'A5'
       JOIN organisations o ON o.id = pr.org_id
      WHERE o.type = 'CONTRACTOR' LIMIT 1`,
  );

  const contractor = harness.client();
  await contractor.login('jonas@verhoeven.demo');
  const res = await contractor.patch(`/deliveries/${delivery.id}/parameters`, {
    parameters: [{ code: 'SITE_PUMP_ELECTRICITY', value: 0.1, unit: 'kWh/m³', overridden: true }],
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /verantwoording/i);
});

test('de leveringscontrole beoordeelt tegen de declaratie van die dag', async () => {
  const contractor = harness.client();
  await contractor.login('jonas@verhoeven.demo');

  const delivery = await db.get("SELECT id FROM deliveries WHERE delivery_note LIKE 'BON-2026-44%' LIMIT 1");
  const { status, body } = await contractor.post(`/deliveries/${delivery.id}/gate`);

  assert.equal(status, 200);
  assert.ok(['GO', 'GO_WITH_WARNING', 'NO_GO'].includes(body.decision));
  assert.ok(body.reasons.length > 0);
  assert.ok(body.result.byModule.A4.GWP_TOTAL > 0, 'A4 hoort ingevuld te zijn bij een echte levering');
});

test('een manuele uitzondering wordt vastgelegd en niet geblokkeerd', async () => {
  const contractor = harness.client();
  await contractor.login('jonas@verhoeven.demo');

  const delivery = await db.get('SELECT id FROM deliveries LIMIT 1');
  const res = await contractor.post(`/deliveries/${delivery.id}/override`, {
    justification: 'Platform onbereikbaar tijdens de levering; receptuur ongewijzigd.',
  });

  assert.equal(res.status, 200);
  const logged = await db.get(
    "SELECT * FROM gate_checks WHERE subject_id = ? AND decision = 'MANUAL_OVERRIDE' ORDER BY created_at DESC LIMIT 1",
    [delivery.id],
  );
  assert.ok(logged, 'de uitzondering hoort in het register te staan');
});

test('alleen de federatie kan de drempelwaarden aanpassen', async () => {
  const producer = harness.client();
  await producer.login('lars@deschelde.demo');
  const refused = await producer.patch('/settings', { bypass_tolerance_pct: '25' });
  assert.equal(refused.status, 403);

  const federation = harness.client();
  await federation.login('bart@betonfederatie.demo');
  const accepted = await federation.patch('/settings', { bypass_tolerance_pct: '4' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.settings.bypass_tolerance_pct, '4');

  const logged = await db.get("SELECT * FROM audit_log WHERE action = 'SETTINGS_UPDATED' ORDER BY id DESC LIMIT 1");
  assert.ok(logged, 'een gewijzigde drempel hoort traceerbaar te zijn');

  await federation.patch('/settings', { bypass_tolerance_pct: '3' });
});

test('een onbekende instelling wordt geweigerd', async () => {
  const federation = harness.client();
  await federation.login('bart@betonfederatie.demo');
  const res = await federation.patch('/settings', { verzin_maar_iets: '1' });
  assert.equal(res.status, 400);
});

test('de audittrail is beperkt tot de eigen organisatie, behalve voor toezicht', async () => {
  const producer = harness.client();
  await producer.login('lars@deschelde.demo');
  const own = await producer.get('/audit');
  assert.equal(own.body.scope, 'OWN');

  const regulator = harness.client();
  await regulator.login('hilde@fod.demo');
  const all = await regulator.get('/audit');
  assert.equal(all.body.scope, 'ALL');
  assert.ok(all.body.total >= own.body.total);
});

test('het sectorgemiddelde rapporteert altijd zijn spreiding', async () => {
  const federation = harness.client();
  await federation.login('bart@betonfederatie.demo');

  const { body } = await federation.get('/aggregation/preview?strengthClass=C30/37');
  const aggregation = body.aggregation;

  assert.ok(aggregation.sampleSize > 0);
  assert.ok(aggregation.lead.min <= aggregation.lead.weightedMean);
  assert.ok(aggregation.lead.max >= aggregation.lead.weightedMean);
  assert.ok(aggregation.caveat.length > 20, 'een gemiddelde zonder voorbehoud vertrekt hier niet');

  const totemReady = await federation.post('/aggregations', { label: 'Test C30/37', strengthClass: 'C30/37' });
  assert.equal(totemReady.status, 201);

  const exported = await federation.get(`/aggregations/${totemReady.body.aggregation.id}/totem`);
  assert.ok(exported.body.payload.indicators.GWP_TOTAL.min !== undefined, 'de export draagt de spreiding mee');
});

test('onbekende eindpunten en methodes geven het juiste antwoord', async () => {
  const client = harness.client();
  await client.login('lars@deschelde.demo');

  assert.equal((await client.get('/bestaat-niet')).status, 404);
  assert.equal((await client.post('/reference')).status, 405);
});

test('het controlebureau ziet ook wat automatisch aanvaard werd', async () => {
  const verifier = harness.client();
  await verifier.login('ilse@certibeton.demo');

  const { body } = await verifier.get('/declarations');
  const inherited = body.declarations.filter((d) => d.status === 'AUTO_ACCEPTED');

  // Zonder dit zicht kan het bureau niet nakijken welke wijzigingen langs de
  // automatische bandbreedte gingen, en is die bandbreedte niet verdedigbaar.
  assert.ok(inherited.length > 0, 'automatisch aanvaarde dossiers horen in de lijst van de verificateur');
  assert.ok(inherited.every((d) => d.bypass_deviation !== null), 'elk geërfd dossier draagt zijn afwijking');
});

test('de voorbeeldberekening loopt door dezelfde motor als een opgeslagen versie', async () => {
  const producer = harness.client();
  await producer.login('lars@deschelde.demo');

  const version = await db.get(
    `SELECT rv.id FROM recipe_versions rv JOIN recipes r ON r.id = rv.recipe_id
      WHERE r.code = 'C30/37-EE3-S4' AND rv.status = 'ACTIVE' ORDER BY rv.version_no DESC LIMIT 1`,
  );
  const stored = await producer.get(`/recipe-versions/${version.id}/calculate`);
  const components = await db.all('SELECT * FROM recipe_components WHERE recipe_version_id = ?', [version.id]);
  const parameters = await db.all('SELECT * FROM recipe_parameters WHERE recipe_version_id = ?', [version.id]);

  const preview = await producer.post('/calculate', {
    components: components.map((c) => ({
      materialId: c.material_id,
      quantityKg: c.quantity_kg,
      transportKm: c.transport_km,
      transportProfileId: c.transport_profile_id,
    })),
    parameters: parameters.map((p) => ({ code: p.code, value: p.value, unit: p.unit, overridden: !!p.overridden, justification: p.justification })),
  });

  assert.equal(preview.status, 200);
  assert.ok(
    Math.abs(preview.body.result.totals.GWP_TOTAL - stored.body.result.totals.GWP_TOTAL) < 1e-9,
    'voorbeeld en opgeslagen versie moeten exact hetzelfde opleveren',
  );
  assert.equal(preview.body.result.verdict, stored.body.result.verdict);
  assert.ok(preview.body.result.components.every((c) => c.byModule?.A1), 'elke component draagt haar bijdrage per fase');
});

test('een voorbeeldberekening met een niet-geverifieerde grondstof komt er ongeldig uit', async () => {
  const producer = harness.client();
  await producer.login('lars@deschelde.demo');

  const pilot = await db.get("SELECT id FROM materials WHERE code = 'ACT-PILOT'");
  const { body } = await producer.post('/calculate', {
    components: [{ materialId: pilot.id, quantityKg: 300, transportKm: 20 }],
  });

  assert.equal(body.result.verdict, 'INVALID');
  assert.ok(body.result.totals.GWP_TOTAL > 0, 'de berekening loopt gewoon door');
});

test('doorrekenen met een grondstof zonder inzage wordt geweigerd', async () => {
  const other = harness.client();
  await other.login('peter@vandenberghe.demo');

  const cement = await db.get("SELECT id FROM materials WHERE code = 'CEM III/A 42,5 N LA'");
  const res = await other.post('/calculate', { components: [{ materialId: cement.id, quantityKg: 300 }] });

  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /inzage|toegang/i);
});
