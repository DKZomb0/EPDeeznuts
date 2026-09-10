/**
 * Who may see and do what.
 *
 * Two independent axes:
 *
 *   organisation type - what kind of party you are (supplier, producer,
 *                       contractor, verifier, federation, regulator)
 *   user role         - ADMIN / EDITOR / VIEWER inside your own organisation
 *
 * On top of that sits the sharing rule the cement suppliers insisted on: a
 * producer sees the *catalogue* of every listed supplier (name, product,
 * category) but not the numbers. Reading a supplier's actual declaration needs
 * a granted access request. Suppliers are competitors and a customer list is
 * commercially sensitive; the catalogue is public precisely because a producer
 * has to be able to find a material before it can ask for it.
 */
import { all, get } from '../db/index.js';
import { ORG_TYPES } from './constants.js';

export class Forbidden extends Error {
  constructor(message = 'Geen toegang tot deze gegevens.') {
    super(message);
    this.status = 403;
    this.code = 'FORBIDDEN';
  }
}

/* ------------------------------------------------------------------ */
/* Capability matrix                                                   */
/* ------------------------------------------------------------------ */

const CAPABILITIES = {
  SUPPLIER: ['materials:write', 'evidence:write', 'access:decide', 'sites:write', 'catalogue:read'],
  PRODUCER: [
    'recipes:write',
    'declarations:submit',
    'access:request',
    'sites:write',
    'catalogue:read',
    'deliveries:read',
    'projects:read',
  ],
  CONTRACTOR: ['projects:write', 'deliveries:write', 'siteparams:write', 'catalogue:read'],
  VERIFIER: ['verification:decide', 'declarations:readall', 'audit:read', 'catalogue:read', 'materials:readall'],
  FEDERATION: [
    'masterdata:write',
    'aggregation:write',
    'declarations:readpublished',
    'settings:write',
    'catalogue:read',
    'audit:read',
  ],
  REGULATOR: ['declarations:readall', 'audit:read', 'catalogue:read', 'aggregation:read', 'materials:readall'],
  PLATFORM: ['*'],
};

/** VIEWER may read everything its organisation can, but never write. */
export function can(user, capability) {
  if (!user) return false;
  const caps = CAPABILITIES[user.orgType] ?? [];
  if (caps.includes('*')) return true;
  if (user.role === 'VIEWER' && capability.endsWith(':write')) return false;
  if (user.role === 'VIEWER' && (capability.endsWith(':submit') || capability.endsWith(':decide'))) return false;
  return caps.includes(capability);
}

export function requireCap(user, capability, message) {
  if (!can(user, capability)) {
    throw new Forbidden(message ?? `Uw rol (${user?.orgType ?? 'onbekend'}) mag deze actie niet uitvoeren.`);
  }
}

/** Oversight roles read across organisations; everyone else sees only its own. */
export function isOversight(user) {
  return [ORG_TYPES.VERIFIER, ORG_TYPES.FEDERATION, ORG_TYPES.REGULATOR, ORG_TYPES.PLATFORM].includes(user?.orgType);
}

export function ownsOrThrow(user, ownerOrgId, message) {
  if (user?.orgId !== ownerOrgId) throw new Forbidden(message ?? 'Dit dossier hoort bij een andere organisatie.');
}

/* ------------------------------------------------------------------ */
/* Material data sharing                                               */
/* ------------------------------------------------------------------ */

/**
 * May `user` see the environmental *numbers* behind a material?
 *
 * Owner: always. Oversight: always - a verifier that cannot open the inputs
 * cannot verify anything. Everyone else: only through a granted request, either
 * for that specific material or for the supplier's whole catalogue.
 */
export async function canReadMaterialData(user, material) {
  if (!user || !material) return false;
  if (material.org_id === user.orgId) return true;
  if (isOversight(user)) return true;

  const grant = await get(
    `SELECT id FROM access_requests
      WHERE requester_org_id = ?
        AND owner_org_id = ?
        AND status = 'GRANTED'
        AND (material_id IS NULL OR material_id = ?)
      LIMIT 1`,
    [user.orgId, material.org_id, material.id],
  );
  return !!grant;
}

/** Material ids this user may read the numbers of, for list endpoints. */
export async function accessibleMaterialIds(user) {
  if (isOversight(user)) return null; // null means "no restriction"
  const rows = await all(
    `SELECT m.id
       FROM materials m
      WHERE m.org_id = ?
      UNION
     SELECT m.id
       FROM materials m
       JOIN access_requests ar
         ON ar.owner_org_id = m.org_id
        AND ar.status = 'GRANTED'
        AND (ar.material_id IS NULL OR ar.material_id = m.id)
      WHERE ar.requester_org_id = ?`,
    [user.orgId, user.orgId],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Strip the numbers out of a material record the user may see but not read.
 * The record itself stays visible: that is what lets a producer discover the
 * material and ask for access.
 */
export function redactMaterial(material) {
  return {
    id: material.id,
    org_id: material.org_id,
    supplier_name: material.supplier_name,
    code: material.code,
    name: material.name,
    category: material.category,
    declared_unit: material.declared_unit,
    site_name: material.site_name ?? null,
    restricted: true,
    evidence_type: material.evidence_type ?? null,
    values: null,
  };
}

/* ------------------------------------------------------------------ */
/* Project module responsibility                                       */
/* ------------------------------------------------------------------ */

/**
 * A4 and A5 belong to whoever was assigned them on the project - normally the
 * contractor, sometimes the producer when it delivers with its own mixers.
 * Only that organisation may enter those parameters, and the audit log records
 * who did. Without this, "wie heeft dit ingevuld?" has no answer.
 */
export async function responsibleOrgFor(projectId, module) {
  const row = await get('SELECT org_id FROM project_responsibilities WHERE project_id = ? AND module = ?', [
    projectId,
    module,
  ]);
  return row?.org_id ?? null;
}

export async function requireResponsibility(user, projectId, module) {
  const orgId = await responsibleOrgFor(projectId, module);
  if (!orgId) {
    throw new Forbidden(`Voor module ${module} is op dit project nog geen verantwoordelijke aangeduid.`);
  }
  if (orgId !== user.orgId && !isOversight(user)) {
    const org = await get('SELECT name FROM organisations WHERE id = ?', [orgId]);
    throw new Forbidden(`Module ${module} is de verantwoordelijkheid van ${org?.name ?? 'een andere partij'}.`);
  }
  return orgId;
}
