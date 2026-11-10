/**
 * CSRF token, client side — T6.1.
 *
 * Flush-time token, per the T6 carry-forward: the client fetches a
 * FRESH token at send time and never stores one — in particular, a
 * queued offline change never carries a token, so a flush after
 * reconnect (or after token rotation) just fetches a new one and
 * sends. The token is bound to the session cookie, so only the
 * signed-in browser can fetch it (another site cannot read the
 * response), and it travels as the `X-CSRF-Token` header.
 *
 * `fetchCsrfToken` takes the fetch implementation so node tests can
 * stub it; the app passes nothing and gets the global fetch.
 * Pre-auth endpoints carry no session yet and are exempt server-side
 * (server/csrf.js) — the senders skip the token fetch for them
 * instead of wasting a round trip that would 401.
 */

export const CSRF_HEADER = 'X-CSRF-Token';

/** Mutating /api paths that carry no session yet (exempt server-side). */
export const CSRF_EXEMPT_PATHS = [
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/resend-otp',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

export function isCsrfExemptPath(path) {
  const clean = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  return CSRF_EXEMPT_PATHS.includes(clean);
}

/** Fetch a fresh token for this session, or null when it cannot be fetched. */
export async function fetchCsrfToken(fetchFn = fetch) {
  try {
    const response = await fetchFn('/api/csrf-token', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return typeof data?.csrf_token === 'string' && data.csrf_token ? data.csrf_token : null;
  } catch {
    return null;
  }
}

/**
 * The extra headers a mutating request needs: a fresh token, fetched
 * at send time. Returns {} when no token applies (exempt path) or
 * when the token could not be fetched — the caller still sends the
 * request, and the server answers 401 (signed out) or 403 (no token)
 * plainly instead of the client guessing.
 */
export async function csrfHeadersFor(path, method = 'GET', fetchFn = fetch) {
  if (String(method || 'GET').toUpperCase() === 'GET') return {};
  if (isCsrfExemptPath(path)) return {};
  const token = await fetchCsrfToken(fetchFn);
  return token ? { [CSRF_HEADER]: token } : {};
}
