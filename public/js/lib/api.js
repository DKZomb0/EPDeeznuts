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
  const payload = text ? JSON.parse(text) : null;

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
