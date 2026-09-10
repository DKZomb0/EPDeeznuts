/**
 * Reference data: everything the client needs to render labels, dropdowns and
 * units without hard-coding domain vocabulary of its own.
 */
import { Router } from '../router.js';
import { all, allSettings, setSetting } from '../../db/index.js';
import { ok, str, badRequest } from '../respond.js';
import { record, notificationsFor, markNotificationsSeen } from '../../lib/audit.js';
import { requireCap } from '../../domain/permissions.js';
import {
  INDICATORS,
  MODULES,
  MATERIAL_CATEGORIES,
  EVIDENCE_TYPES,
  VERDICTS,
  PARAMETER_DEFS,
  ORG_TYPE_LABELS,
  DECLARATION_STATUS_LABELS,
  DECLARED_UNITS,
  SCOPES,
  LEAD_INDICATOR,
} from '../../domain/constants.js';

const router = new Router();

router.get('/reference', async ({ res }) => {
  const [transportProfiles, energyFactors, categoryRules, strengthClasses, processDefaults, settings, organisations] =
    await Promise.all([
      all('SELECT id, code, name, mode, payload_t, empty_return, source, valid_from, note FROM transport_profiles ORDER BY mode, code'),
      all('SELECT id, code, name, unit, source, valid_from, note FROM energy_factors ORDER BY code'),
      all('SELECT * FROM category_rules ORDER BY category'),
      all('SELECT * FROM strength_classes ORDER BY sort'),
      all('SELECT code, value, unit, source, note FROM process_defaults ORDER BY code'),
      allSettings(),
      all('SELECT id, name, type, city FROM organisations WHERE listed = 1 ORDER BY type, name'),
    ]);

  ok(res, {
    indicators: INDICATORS,
    leadIndicator: LEAD_INDICATOR,
    modules: MODULES,
    scopes: SCOPES,
    materialCategories: MATERIAL_CATEGORIES,
    declaredUnits: DECLARED_UNITS,
    evidenceTypes: EVIDENCE_TYPES,
    verdicts: VERDICTS,
    parameterDefs: PARAMETER_DEFS,
    orgTypeLabels: ORG_TYPE_LABELS,
    declarationStatusLabels: DECLARATION_STATUS_LABELS,
    transportProfiles,
    energyFactors,
    categoryRules,
    strengthClasses,
    processDefaults,
    organisations,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  });
});

/**
 * Settings are the negotiated thresholds - the bypass tolerances above all.
 * They belong to the federation, and every change is written to the audit log
 * because "who moved the tolerance to 10 %?" has to be answerable.
 */
router.patch('/settings', async ({ res, user, body }) => {
  requireCap(user, 'settings:write', 'Alleen de sectorfederatie kan de drempelwaarden aanpassen.');

  const allowed = [
    'bypass_tolerance_pct',
    'bypass_cumulative_pct',
    'bypass_max_consecutive',
    'bypass_allow_new_material',
    'declaration_validity_months',
    'delivery_tolerance_pct',
  ];
  const changes = {};

  for (const [key, value] of Object.entries(body ?? {})) {
    if (!allowed.includes(key)) throw badRequest(`Instelling "${key}" bestaat niet of is niet aanpasbaar.`);
    const val = str(value, key, { required: true, max: 32 });
    if (key !== 'bypass_allow_new_material' && !Number.isFinite(Number(val))) {
      throw badRequest(`Instelling "${key}" moet een getal zijn.`);
    }
    await setSetting(key, val, user.id);
    changes[key] = val;
  }

  await record(user, 'SETTINGS_UPDATED', { type: 'SETTINGS', id: 'global' }, `Drempelwaarden aangepast: ${Object.keys(changes).join(', ')}.`, changes);
  const settings = await allSettings();
  ok(res, { settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
});

router.get('/notifications', async ({ res, user }) => {
  ok(res, { notifications: await notificationsFor(user.orgId) });
});

router.post('/notifications/seen', async ({ res, user }) => {
  await markNotificationsSeen(user.orgId);
  ok(res, { ok: true });
});

router.get('/organisations', async ({ res }) => {
  ok(res, { organisations: await all('SELECT id, name, type, city, vat FROM organisations WHERE listed = 1 ORDER BY type, name') });
});

router.get('/sites', async ({ res, user }) => {
  ok(res, { sites: await all('SELECT * FROM sites WHERE org_id = ? AND archived = 0 ORDER BY name', [user.orgId]) });
});

export default router;
