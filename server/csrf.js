/**
 * CSRF protection — T6.1.
 *
 * The twin authenticates with a session cookie (`SameSite=Lax`,
 * httpOnly), so a mutating request the browser sends on its own is
 * the attack to stop: a forged POST from another site would ride the
 * cookie. The defense is a flush-time token, per the T6 carry-forward:
 *
 *   - GET /api/csrf-token (signed in only) issues a token bound to
 *     the caller's session id. The token is HMAC-SHA256(SESSION_SECRET,
 *     `csrf-v1:<sessionId>:<window>`) with a 10-minute window; the
 *     server accepts the current window and the one before it, so a
 *     token fetched just before a window boundary still works.
 *   - The client fetches a FRESH token at send time and sends it as
 *     the `X-CSRF-Token` header. Nothing is ever stored — in
 *     particular, a queued offline change never carries a token, so
 *     replays survive token rotation (see src/lib/syncClient.js).
 *   - The middleware enforces the token on every mutating /api
 *     request (POST/PUT/PATCH/DELETE) that carries a live session.
 *     A request with no live session passes through untouched, so
 *     the route's own auth still answers 401 (never a 403 that
 *     would mask "signed out").
 *
 * Stateless: no DB row, no migration — the session id is the secret
 * only the signed-in browser holds, and the HMAC key is the session
 * secret itself. A token from another session, a forged token, or a
 * token from a future window is rejected with 403 `csrf_invalid`.
 *
 * Exempt by necessity, not by convenience:
 *   - The pre-auth endpoints (/api/auth/register, /verify,
 *     /resend-otp, /login, /forgot-password, /reset-password):
 *     no session exists yet, so there is nothing to bind a token
 *     to. They keep their own defenses (rate limits, OTP codes).
 *   - /api/billing/wipe-sweep and /api/billing/trial-reminder-sweep:
 *     server-to-server job calls guarded by the billing job secret,
 *     never browser flows.
 *   - The Stripe webhook is not under /api and is HMAC-verified
 *     on its raw body (T4) — it never reaches this middleware.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { SESSION_COOKIE, loadSessionUser } from './sessions.js';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_WINDOW_MS = 10 * 60 * 1000;

/** Paths under /api whose mutating calls carry no session to bind to. */
export const CSRF_EXEMPT_PATHS = [
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/resend-otp',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/recover',
  '/api/auth/recover/verify',
  '/api/billing/wipe-sweep',
  '/api/billing/trial-reminder-sweep',
];

export function isCsrfExempt(path) {
  const clean = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  return CSRF_EXEMPT_PATHS.includes(clean);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfSecret() {
  return process.env.SESSION_SECRET || config.sessionSecret || '';
}

function windowFor(now) {
  return Math.floor(now / CSRF_WINDOW_MS);
}

function hmacFor(sessionId, window) {
  return crypto
    .createHmac('sha256', csrfSecret())
    .update(`csrf-v1:${sessionId}:${window}`)
    .digest('hex');
}

/** Issue a token for a session id. `now` is injectable for tests. */
export function issueCsrfToken(sessionId, now = Date.now()) {
  const window = windowFor(now);
  return `${window}.${hmacFor(sessionId, window)}`;
}

/** True when the token was issued for this session in a live window. */
export function verifyCsrfToken(sessionId, token, now = Date.now()) {
  if (!sessionId || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const window = Number(token.slice(0, dot));
  if (!Number.isInteger(window)) return false;
  const current = windowFor(now);
  // Current window, or the one just before it (a token fetched
  // right before the boundary must not die mid-send). Never a
  // future window, never an old one.
  if (window !== current && window !== current - 1) return false;
  const signature = token.slice(dot + 1);
  const expected = hmacFor(sessionId, window);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Express middleware: enforce a fresh CSRF token on mutating /api
 * requests that carry a live session. Safe methods, exempt paths,
 * and requests with no live session pass through untouched.
 */
export function requireCsrf(pool) {
  return async (req, res, next) => {
    try {
      if (!MUTATING_METHODS.has(String(req.method || '').toUpperCase())) return next();
      if (isCsrfExempt(req.path)) return next();
      const cookies = req.headers?.cookie || '';
      const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
      if (!match) return next();
      let loaded = null;
      try {
        loaded = await loadSessionUser(pool, decodeURIComponent(match[1]));
      } catch {
        // No database, or the session row is unreadable: the route's
        // own auth answers (401/503), never this middleware.
        return next();
      }
      if (!loaded) return next();
      const token = req.headers?.[CSRF_HEADER];
      if (!verifyCsrfToken(loaded.sessionId, token)) {
        return res.status(403).json({
          error: 'csrf_invalid',
          message: 'That request did not carry a valid security token. Refresh and try again.',
        });
      }
      return next();
    } catch (error) {
      console.error('[twin] csrf check failed:', error.message);
      return next();
    }
  };
}
