/**
 * The validity rules, tested without a database.
 *
 * These are the rules the sector actually argued about, so they get the most
 * literal tests in the suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidence, evaluateModuleCoverage, rollup, publishable, approvable } from '../server/domain/validity.js';
import { worstVerdict } from '../server/domain/constants.js';

const AT = '2026-06-01T00:00:00.000Z';

test('een geldige BEPD levert een geldig oordeel', () => {
  const { verdict } = evaluateEvidence(
    { type: 'BEPD', number: 'BEPD-2025-CEM-0114', valid_from: '2025-01-01', valid_until: '2030-01-01' },
    AT,
    'cement',
  );
  assert.equal(verdict, 'VALID');
});

test('een ontbrekend bewijsstuk maakt de input ongeldig', () => {
  const { verdict, reasons } = evaluateEvidence(null, AT, 'cement');
  assert.equal(verdict, 'INVALID');
  assert.equal(reasons[0].code, 'EVIDENCE_MISSING');
});

test('een BEPD zonder registratienummer is niet controleerbaar en dus ongeldig', () => {
  const { verdict, reasons } = evaluateEvidence({ type: 'BEPD', number: '  ', valid_until: '2030-01-01' }, AT, 'cement');
  assert.equal(verdict, 'INVALID');
  assert.ok(reasons.some((r) => r.code === 'EVIDENCE_NUMBER_MISSING'));
});

test('een vervallen BEPD dekt de referentiedatum niet meer', () => {
  const { verdict, reasons } = evaluateEvidence({ type: 'BEPD', number: 'X', valid_until: '2026-01-01' }, AT, 'cement');
  assert.equal(verdict, 'INVALID');
  assert.ok(reasons.some((r) => r.code === 'EVIDENCE_EXPIRED'));
});

test('een BEPD die binnenkort vervalt blijft geldig maar waarschuwt', () => {
  const { verdict, reasons } = evaluateEvidence({ type: 'BEPD', number: 'X', valid_until: '2026-07-15' }, AT, 'cement');
  assert.equal(verdict, 'VALID');
  assert.ok(reasons.some((r) => r.code === 'EVIDENCE_EXPIRING'));
});

test('een internationale EPD blijft bruikbaar maar krijgt een vlag', () => {
  const { verdict, reasons } = evaluateEvidence(
    { type: 'EPD_INTL', number: 'EFCA-PCE-2023-004', programme: 'EFCA', valid_until: '2028-09-01' },
    AT,
    'hulpstof',
  );
  assert.equal(verdict, 'VALID_WITH_WARNINGS');
  assert.ok(reasons.some((r) => r.code === 'EVIDENCE_INTERNATIONAL'));
});

test('een generieke sectorwaarde is enkel indicatief', () => {
  const { verdict } = evaluateEvidence({ type: 'SECTOR_GENERIC' }, AT, 'zand');
  assert.equal(verdict, 'INDICATIVE');
});

test('een eigen opgave zonder verificatie maakt het resultaat ongeldig', () => {
  const { verdict } = evaluateEvidence({ type: 'SELF_DECLARED' }, AT, 'pigment');
  assert.equal(verdict, 'INVALID');
});

test('ontbrekende verplichte modules maken de declaratie onvolledig', () => {
  const rule = { category: 'CEMENT', required_modules: 'A1,A2,A3' };
  const ok = evaluateModuleCoverage(['A1', 'A2', 'A3'], rule, 'cement');
  assert.equal(ok.verdict, 'VALID');

  const incomplete = evaluateModuleCoverage(['A1'], rule, 'cement');
  assert.equal(incomplete.verdict, 'INVALID');
  assert.deepEqual(incomplete.reasons[0].detail.missing, ['A2', 'A3']);
});

test('het oordeel rolt op naar het slechtste dat ergens in de keten voorkomt', () => {
  const { verdict } = rollup([
    evaluateEvidence({ type: 'BEPD', number: 'A', valid_until: '2030-01-01' }, AT, 'cement'),
    evaluateEvidence({ type: 'BEPD', number: 'B', valid_until: '2030-01-01' }, AT, 'zand'),
    evaluateEvidence({ type: 'SELF_DECLARED' }, AT, 'pigment'),
  ]);
  assert.equal(verdict, 'INVALID', 'één niet-geverifieerde grondstof maakt het hele dossier ongeldig');
});

test('bevindingen staan gesorteerd met de blokkerende bovenaan', () => {
  const { reasons } = rollup([
    evaluateEvidence({ type: 'EPD_INTL', number: 'A', valid_until: '2030-01-01' }, AT, 'hulpstof'),
    evaluateEvidence(null, AT, 'pigment'),
  ]);
  assert.equal(reasons[0].verdict, 'INVALID');
});

test('worstVerdict kiest de zwaarste ernst', () => {
  assert.equal(worstVerdict(['VALID', 'VALID_WITH_WARNINGS']), 'VALID_WITH_WARNINGS');
  assert.equal(worstVerdict(['INDICATIVE', 'INVALID', 'VALID']), 'INVALID');
  assert.equal(worstVerdict([]), 'VALID');
});

test('publiceren als BEPD vraagt een volledig schoon oordeel; goedkeuren mag ruimer', () => {
  assert.equal(publishable('VALID'), true);
  assert.equal(publishable('VALID_WITH_WARNINGS'), false);

  // Een buitenlandse EPD mag door de verificatie, een ontbrekend bewijsstuk niet.
  assert.equal(approvable('VALID_WITH_WARNINGS'), true);
  assert.equal(approvable('INDICATIVE'), false);
  assert.equal(approvable('INVALID'), false);
});
