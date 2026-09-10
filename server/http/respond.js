/**
 * Request/response plumbing shared by every route.
 */

export function json(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function ok(res, payload) {
  json(res, 200, payload);
}

export function created(res, payload) {
  json(res, 201, payload);
}

export function noContent(res) {
  res.writeHead(204);
  res.end();
}

/**
 * Errors carry a `status` and reach the client as a readable Dutch message -
 * these surface directly in the interface, so they are written for the person
 * reading them, not for a log file.
 */
export function fail(res, err) {
  const status = err?.status ?? 500;
  if (status >= 500) console.error('[epd]', err);
  json(res, status, {
    error: {
      code: err?.code ?? (status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED'),
      message: status >= 500 ? 'Er ging intern iets mis. Probeer opnieuw of neem contact op met de beheerder.' : err.message,
      detail: err?.detail ?? null,
    },
  });
}

export class HttpError extends Error {
  constructor(status, message, code = null, detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (message, detail) => new HttpError(400, message, 'BAD_REQUEST', detail);
export const unauthorised = (message = 'Meld u aan om verder te gaan.') => new HttpError(401, message, 'UNAUTHORISED');
export const notFound = (message = 'Niet gevonden.') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message) => new HttpError(409, message, 'CONFLICT');
export const unprocessable = (message, detail) => new HttpError(422, message, 'UNPROCESSABLE', detail);

/** Read and parse a JSON body, with a size cap. */
export async function readBody(req, limit = 1_000_000) {
  if (req.body !== undefined && req.body !== null) {
    // Vercel's Node runtime may have parsed it already.
    return typeof req.body === 'string' ? safeParse(req.body) : req.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw badRequest('De verzonden gegevens zijn te groot.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('De verzonden gegevens zijn geen geldige JSON.');
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token, expires) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader(
    'set-cookie',
    `epd_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`,
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('set-cookie', `epd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

/* ------------------------------------------------------------------ */
/* Input coercion                                                      */
/* ------------------------------------------------------------------ */

export function str(value, field, { required = false, max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Veld "${field}" is verplicht.`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw badRequest(`Veld "${field}" is te lang.`);
  return s;
}

export function num(value, field, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Veld "${field}" is verplicht.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`Veld "${field}" moet een getal zijn.`);
  if (n < min || n > max) throw badRequest(`Veld "${field}" moet tussen ${min} en ${max} liggen.`);
  return n;
}

export function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function oneOf(value, allowed, field, { required = false } = {}) {
  const s = str(value, field, { required });
  if (s === null) return null;
  if (!allowed.includes(s)) throw badRequest(`Veld "${field}" moet één van ${allowed.join(', ')} zijn.`);
  return s;
}
