/**
 * Formatting. Everything is nl-BE: comma decimals, dotted thousands,
 * dd/mm/yyyy. Getting this wrong makes a technical document look amateurish to
 * exactly the audience that has to trust it.
 */

const nf = (min, max) => new Intl.NumberFormat('nl-BE', { minimumFractionDigits: min, maximumFractionDigits: max });

export function num(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return nf(decimals, decimals).format(Number(value));
}

/** Adaptive precision: big numbers get fewer decimals, tiny ones get more. */
export function smart(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000) return nf(0, 0).format(n);
  if (abs >= 10) return nf(1, 1).format(n);
  if (abs >= 1) return nf(2, 2).format(n);
  if (abs >= 0.001) return nf(3, 4).format(n);
  return n.toExponential(2).replace('.', ',');
}

export function pct(value, decimals = 1) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${nf(decimals, decimals).format(n)} %`;
}

export function date(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relative(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.round(diff / 86400_000);
  if (Number.isNaN(days)) return date(value);
  if (Math.abs(days) < 1) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days > 1 && days < 31) return `${days} dagen geleden`;
  if (days < 0 && days > -31) return `over ${Math.abs(days)} dagen`;
  return date(value);
}

export function initials(name) {
  return String(name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/* ------------------------------------------------------------------ */
/* Domain vocabulary                                                   */
/* ------------------------------------------------------------------ */

/**
 * Tagklassen uit het designsysteem. Drie niveaus, meer niet:
 *   tag-accent   in orde, de normale toestand
 *   tag-outline  bruikbaar maar gemerkt — vraagt een menselijke blik
 *   tag-neutral  geblokkeerd of waardeloos
 * Die schaal is overgenomen uit het ontwerp (BEPD / Ecoinvent / geen bron) en
 * geldt daarom overal in de toepassing hetzelfde.
 */
export const VERDICT_TAG = {
  VALID: 'tag-accent',
  VALID_WITH_WARNINGS: 'tag-outline',
  INDICATIVE: 'tag-outline',
  INVALID: 'tag-neutral',
};

export const STATUS_TAG = {
  DRAFT: 'tag-quiet',
  SUBMITTED: 'tag-outline',
  UNDER_VERIFICATION: 'tag-outline',
  VERIFIED: 'tag-accent',
  PUBLISHED: 'tag-accent',
  AUTO_ACCEPTED: 'tag-accent',
  REJECTED: 'tag-neutral',
  EXPIRED: 'tag-quiet',
  PENDING: 'tag-outline',
  GRANTED: 'tag-accent',
  DENIED: 'tag-neutral',
  REVOKED: 'tag-quiet',
  GO: 'tag-accent',
  GO_WITH_WARNING: 'tag-outline',
  NO_GO: 'tag-neutral',
  MANUAL_OVERRIDE: 'tag-outline',
  ACTIVE: 'tag-accent',
  SUPERSEDED: 'tag-quiet',
  ARCHIVED: 'tag-quiet',
  PLANNED: 'tag-outline',
  DELIVERED: 'tag-accent',
};

export const EVIDENCE_TAG = {
  BEPD: 'tag-accent',
  EPD_INTL: 'tag-outline',
  SECTOR_GENERIC: 'tag-neutral',
  SELF_DECLARED: 'tag-neutral',
};

export const GATE_LABELS = {
  GO: 'Vrijgegeven',
  GO_WITH_WARNING: 'Vrijgegeven met opmerking',
  NO_GO: 'Niet vrij te geven',
  MANUAL_OVERRIDE: 'Manuele uitzondering',
};

/** Trim an id for display without losing its recognisable prefix. */
export function shortId(value) {
  if (!value) return '—';
  const [prefix, rest] = String(value).split('_');
  return rest ? `${prefix}_${rest.slice(0, 6)}` : value;
}
