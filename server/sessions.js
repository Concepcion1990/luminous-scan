/**
 * Sessions — T2.
 *
 * Cookie: `twin_session` = `<sessionId>.<hmac>`, where hmac is
 * HMAC-SHA256(SESSION_SECRET, sessionId). Signed, httpOnly, SameSite
 * lax; Secure on Fly (production / force_https) — see `cookieOptions`.
 * The cookie is only a bearer for a server-side row: every request
 * re-checks the `sessions` table (not revoked, not expired), so a
 * session can be revoked on logout and on password change
 * (logout-everywhere). SESSION_SECRET comes from env only — if it is
 * unset, auth refuses to start a session (fail closed, 503).
 */
import crypto from 'node:crypto';
import { config } from './config.js';

export const SESSION_COOKIE = 'twin_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Recovery sessions (spare-key entry) are short-lived on purpose. */
export const RECOVERY_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function sessionSecretConfigured() {
  return Boolean(process.env.SESSION_SECRET || config.sessionSecret);
}

function sessionSecret() {
  return process.env.SESSION_SECRET || config.sessionSecret || '';
}

export function signSessionId(sessionId) {
  const hmac = crypto.createHmac('sha256', sessionSecret()).update(sessionId).digest('hex');
  return `${sessionId}.${hmac}`;
}

export function verifySignedSessionId(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', sessionSecret()).update(sessionId).digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function cookieOptions(req) {
  const isHttps = req?.protocol === 'https' || req?.headers?.['x-forwarded-proto'] === 'https';
  const secure = config.nodeEnv === 'production' || isHttps;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Create a session row and return its id. `scope` is 'full' for a
 * normal sign-in, or 'recovery' for the spare-key emergency session
 * (migration 011) — a recovery session can reach ONLY the
 * change-email flow (the allowlist lives in server/app.js) and lives
 * for RECOVERY_SESSION_TTL_MS unless `ttlMs` overrides.
 */
export async function createSession(client, userId, { userAgent, ipAddress, scope = 'full', ttlMs = null } = {}) {
  const id = crypto.randomUUID();
  const lifetime = ttlMs ?? (scope === 'recovery' ? RECOVERY_SESSION_TTL_MS : SESSION_TTL_MS);
  const expiresAt = new Date(Date.now() + lifetime);
  await client.query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address, scope)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, expiresAt.toISOString(), userAgent || null, ipAddress || null, scope],
  );
  return { id, expiresAt };
}

export async function revokeSession(client, sessionId) {
  await client.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);
}

/** Logout-everywhere: revoke every session for the user (password change). */
export async function revokeAllSessions(client, userId) {
  await client.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

/** Revoke every session for the user EXCEPT one (an email change keeps
 *  the session that proved itself and kills every other door). */
export async function revokeOtherSessions(client, userId, keepSessionId) {
  await client.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
    [userId, keepSessionId],
  );
}

/** A recovery session that completed its one job becomes a normal
 *  session with a normal lifetime. */
export async function graduateSession(client, sessionId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.query(
    "UPDATE sessions SET scope = 'full', expires_at = $2 WHERE id = $1",
    [sessionId, expiresAt.toISOString()],
  );
  return expiresAt;
}

/** Load the live session + user for a signed cookie value, or null. */
export async function loadSessionUser(pool, signedValue) {
  const sessionId = verifySignedSessionId(signedValue);
  if (!sessionId) return null;
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.scope,
            u.id, u.email, u.email_verified, u.active_business_id, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    sessionId: row.session_id,
    // Pre-011 rows (and engines that lag the migration) read as full.
    scope: row.scope === 'recovery' ? 'recovery' : 'full',
    user: {
      id: row.id,
      email: row.email,
      email_verified: row.email_verified,
      active_business_id: row.active_business_id,
      created_at: row.created_at,
    },
  };
}

/** Express middleware: 401 unless a live session exists. Sets req.user. */
export function requireAuth(pool) {
  return async (req, res, next) => {
    try {
      const cookies = parseCookies(req);
      const loaded = await loadSessionUser(pool, cookies[SESSION_COOKIE]);
      if (!loaded) {
        return res.status(401).json({ error: 'not_signed_in' });
      }
      req.user = loaded.user;
      req.sessionId = loaded.sessionId;
      req.sessionScope = loaded.scope;
      return next();
    } catch (error) {
      console.error('[twin] auth check failed:', error.message);
      return res.status(401).json({ error: 'not_signed_in' });
    }
  };
}
