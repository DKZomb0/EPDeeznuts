import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Prefixed, sortable-ish identifiers. The prefix makes audit trails and URLs
 * readable ("mat_x8f2..." is obviously a material) which matters a lot when a
 * verifier is reading a dossier next to a PDF.
 */
export function id(prefix) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function token() {
  return randomBytes(32).toString('base64url');
}

export function uuid() {
  return randomUUID();
}

/** Sequential-looking human reference, e.g. BEPD-2026-0007. */
export function reference(prefix, n, year = new Date().getUTCFullYear()) {
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
