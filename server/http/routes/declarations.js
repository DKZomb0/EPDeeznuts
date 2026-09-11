/**
 * Declarations: submission, the change-control gate, verification, publication.
 */
import { Router } from '../router.js';
import { get } from '../../db/index.js';
import { ok, created, str, oneOf, notFound, badRequest } from '../respond.js';
import { requireCap, isOversight, Forbidden } from '../../domain/permissions.js';
import {
  submitDeclaration,
  takeIntoVerification,
  decideVerification,
  publishDeclaration,
  declarationDetail,
  listDeclarations,
} from '../../domain/declarations.js';
import { buildReport } from '../../domain/report.js';
import { forEntity } from '../../lib/audit.js';
import { SCOPES, ORG_TYPES } from '../../domain/constants.js';

const router = new Router();

router.get('/declarations', async ({ res, user, query }) => {
  const statuses = query.status ? query.status.split(',') : null;

  // A verifier sees the queue, oversight sees everything, a producer sees only
  // its own dossiers.
  let filter;
  if (user.orgType === ORG_TYPES.VERIFIER) {
    // AUTO_ACCEPTED hoort er uitdrukkelijk bij: het controlebureau moet kunnen
    // nakijken welke wijzigingen langs de automatische bandbreedte gingen. Zonder
    // dat zicht is de bandbreedte zelf niet verdedigbaar.
    filter = { statuses: statuses ?? ['SUBMITTED', 'UNDER_VERIFICATION', 'VERIFIED', 'PUBLISHED', 'REJECTED', 'AUTO_ACCEPTED'] };
  } else if (isOversight(user)) {
    filter = { statuses };
  } else {
    filter = { orgId: user.orgId, statuses };
  }

  ok(res, { declarations: await listDeclarations(filter) });
});

router.get('/declarations/:id', async ({ res, user, params }) => {
  const declaration = await declarationDetail(params.id);
  if (!declaration) throw notFound('Declaratie niet gevonden.');
  if (declaration.org_id !== user.orgId && !isOversight(user)) {
    throw new Forbidden('Dit dossier hoort bij een andere organisatie.');
  }
  ok(res, { declaration, audit: await forEntity('DECLARATION', params.id, 50) });
});

/**
 * Submitting runs the change-control gate. The response always carries the
 * gate's full reasoning, whether it let the version through or not - a producer
 * planning a change needs to know which side of the line it landed on and why.
 */
router.post('/declarations', async ({ res, user, body }) => {
  requireCap(user, 'declarations:submit', 'Alleen een betonproducent kan een declaratie indienen.');

  const recipeVersionId = str(body.recipeVersionId, 'receptuurversie', { required: true });
  const version = await get('SELECT * FROM recipe_versions WHERE id = ?', [recipeVersionId]);
  if (!version) throw notFound('Receptuurversie niet gevonden.');
  const recipe = await get('SELECT * FROM recipes WHERE id = ?', [version.recipe_id]);
  if (recipe.org_id !== user.orgId) throw new Forbidden('Deze receptuur hoort bij een andere producent.');

  let verifierOrgId = str(body.verifierOrgId, 'verificatie-instelling');
  if (verifierOrgId) {
    const verifier = await get("SELECT id FROM organisations WHERE id = ? AND type = 'VERIFIER'", [verifierOrgId]);
    if (!verifier) throw badRequest('De gekozen verificatie-instelling bestaat niet.');
  } else {
    verifierOrgId = (await get("SELECT id FROM organisations WHERE type = 'VERIFIER' ORDER BY name LIMIT 1"))?.id ?? null;
  }

  const outcome = await submitDeclaration(
    {
      recipeVersionId,
      scope: oneOf(body.scope, Object.values(SCOPES), 'scope') ?? 'A1-A3',
      verifierOrgId,
    },
    user,
  );

  created(res, {
    declaration: outcome.declaration,
    gate: outcome.gate,
    verdict: outcome.result.verdict,
    lead: outcome.result.lead,
  });
});

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

router.post('/declarations/:id/take', async ({ res, user, params }) => {
  requireCap(user, 'verification:decide', 'Alleen een verificatie-instelling kan een dossier in behandeling nemen.');
  ok(res, { declaration: await takeIntoVerification(params.id, user) });
});

router.post('/declarations/:id/decide', async ({ res, user, params, body }) => {
  requireCap(user, 'verification:decide', 'Alleen een verificatie-instelling kan een dossier beoordelen.');

  const approve = body.decision === 'APPROVE' || body.decision === true;
  // A rejection without a reason is useless to the producer receiving it.
  const note = str(body.note, 'motivering', { required: !approve, max: 4000 });

  ok(res, {
    declaration: await decideVerification(params.id, { approve, note, certificateNo: str(body.certificateNo, 'certificaatnummer') }, user),
  });
});

router.post('/declarations/:id/publish', async ({ res, user, params }) => {
  requireCap(user, 'verification:decide', 'Publicatie gebeurt door de verificatie-instelling.');
  ok(res, { declaration: await publishDeclaration(params.id, user) });
});

/** The full transparency report for a dossier. */
router.get('/declarations/:id/report', async ({ res, user, params }) => {
  const declaration = await get('SELECT * FROM declarations WHERE id = ?', [params.id]);
  if (!declaration) throw notFound('Declaratie niet gevonden.');
  if (declaration.org_id !== user.orgId && !isOversight(user)) {
    throw new Forbidden('Dit dossier hoort bij een andere organisatie.');
  }
  ok(res, {
    report: await buildReport({
      recipeVersionId: declaration.recipe_version_id,
      declarationId: declaration.id,
      scope: declaration.scope,
    }),
  });
});

export default router;
