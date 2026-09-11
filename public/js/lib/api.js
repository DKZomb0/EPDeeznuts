/**
 * API client.
 *
 * Errors from the server carry a Dutch message written for the person reading
 * it, so they are surfaced as-is rather than being replaced by a generic
 * "something went wrong".
 */

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message ?? `Fout ${status}`);
    this.status = status;
    this.code = payload?.error?.code ?? null;
    this.detail = payload?.error?.detail ?? null;
    // Het volledige antwoord blijft bewaard: een opstartfout stuurt de
    // diagnose mee naast de foutboodschap.
    this.payload = payload ?? null;
  }
}

async function request(method, path, body = null) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Niet alles wat antwoordt is deze toepassing: een hostingplatform zet er
    // bij een mislukte functie zijn eigen HTML-foutpagina neer. Daarop
    // struikelen betekent dat de échte fout nooit op het scherm komt, dus
    // wordt de ruwe tekst hier bewaard in plaats van weggegooid.
    payload = {
      error: {
        code: 'NON_JSON_RESPONSE',
        message: `De server antwoordde met ${response.status}, maar niet met JSON — dit komt niet van de toepassing zelf.`,
        detail: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      },
    };
    throw new ApiError(response.status, payload);
  }

  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path),
};

/** Build a query string, dropping empty values. */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
