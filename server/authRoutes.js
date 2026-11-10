/**
 * Auth + business routes — T2 (plan §4.3, §5.2).
 *
 *   POST /api/auth/register        { email, password } -> 201 + OTP emailed
 *   POST /api/auth/verify          { email, otpCode }  -> 200 + session cookie
 *   POST /api/auth/resend-otp      { email }           -> 200 (always; no enumeration)
 *   POST /api/auth/login           { email, password } -> 200 + session cookie
 *   POST /api/auth/logout          -> 200, session revoked, cookie cleared
 *   GET  /api/auth/me              -> 200 user | 401
 *   PATCH /api/auth/me             { active_business_id } -> 200 user
 *   POST /api/auth/forgot-password { email }           -> 200 (always; no enumeration)
 *   POST /api/auth/reset-password  { resetToken, newPassword } -> 200
 *   GET  /api/businesses           -> 200 { items: [...] }
 *   POST /api/businesses           { name, tagline?, currency? } -> 201
 *   POST /api/businesses/:id/switch -> 200 { active_business_id }
 *
 * Security rules, all fail-closed:
 * - No user enumeration: login / OTP / reset errors never say whether an
 *   email exists. Login returns the same generic 401 for unknown email,
 *   wrong password, and unverified account.
 * - Passwords: bcrypt only (server/passwords.js); never stored/logged.
 * - OTP codes: hashed, 10-min, single-use, 5 attempts, 60 s resend
 *   cooldown (server/otp.js). Plaintext codes are never stored/logged.
 * - Sessions: signed httpOnly cookies over server-side rows
 *   (server/sessions.js); logout revokes, password change revokes all.
 * - Registration creates NO paid access of any kind (T4 owns billing).
 * - Businesses: until T4 lands, every account is treated as Essentials
 *   — 1 business, enforced server-side (recorded assumption).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { hashPassword, verifyPassword, dummyPasswordCheck } from './passwords.js';
import { checkLimit, resetRateLimits } from './rateLimit.js';
import { sendMail, verificationEmail, passwordResetEmail, EmailNotConfigured } from './email.js';
import {
  issueOtp,
  secondsSinceLastOtp,
  verifyOtpCode,
  hashOtpCode,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
} from './otp.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  revokeSession,
  revokeAllSessions,
  requireAuth,
  sessionSecretConfigured,
  signSessionId,
  verifySignedSessionId,
  parseCookies,
} from './sessions.js';
import { activateStaffRowsForEmail } from './staff.js';

/** Essentials business cap until T4 (no entitlements yet — see header). */
export const ESSENTIALS_BUSINESS_LIMIT = 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

/** Base44's password rule (ported Register page): 8+ chars, max 72 bytes. */
function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must be at most 72 bytes.';
  }
  return null;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    email_verified: row.email_verified,
    active_business_id: row.active_business_id ?? null,
    created_date: row.created_at,
  };
}

function publicBusiness(row) {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline || '',
    currency: row.currency || 'USD',
    owner_id: row.owner_id,
    created_by_id: row.created_by_id,
    created_date: row.created_at,
    updated_date: row.updated_at,
    // T6 identity fields (migration 006). The app name is NOT here —
    // Luminous StockHaven stays the app name and is not changeable.
    logo_url: row.logo_url || '',
    brand_color: row.brand_color || '#145042',
    contact_email: row.contact_email || '',
    contact_phone: row.contact_phone || '',
    website: row.website || '',
    address: row.address || '',
    timezone: row.timezone || '',
    date_format: row.date_format || 'MMM d, yyyy',
    unit_system: row.unit_system || 'imperial',
    language: row.language || 'en',
  };
}

// T6: the identity fields Settings may save, and their validation.
// Languages mirror src/lib/i18n.js (LOCALES) — 'ar' + 'en' in T6.3;
// the registry grows one language at a time, ABC order, her call.
const BUSINESS_UPDATE_FIELDS = [
  'name', 'tagline', 'logo_url', 'brand_color', 'contact_email',
  'contact_phone', 'website', 'address', 'currency', 'timezone',
  'date_format', 'unit_system', 'language',
];
const SUPPORTED_LANGUAGES = ['ar', 'en'];
const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'MXN', 'JPY'];
const SUPPORTED_DATE_FORMATS = ['MMM d, yyyy', 'd MMM yyyy', 'M/d/yyyy', 'yyyy-MM-dd'];

function validateBusinessPatch(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!BUSINESS_UPDATE_FIELDS.includes(key)) continue;
    const text = typeof value === 'string' ? value.trim() : '';
    if (key === 'name') {
      if (!text || text.length > 120) return { error: 'Enter a business name (up to 120 characters).' };
      clean.name = text;
    } else if (key === 'brand_color') {
      if (!/^#[0-9a-fA-F]{6}$/.test(text)) return { error: 'Pick a brand color.' };
      clean.brand_color = text.toLowerCase();
    } else if (key === 'language') {
      if (!SUPPORTED_LANGUAGES.includes(text)) return { error: 'That language is not available yet.' };
      clean.language = text;
    } else if (key === 'currency') {
      if (!SUPPORTED_CURRENCIES.includes(text.toUpperCase())) return { error: 'Choose a supported currency.' };
      clean.currency = text.toUpperCase();
    } else if (key === 'date_format') {
      if (!SUPPORTED_DATE_FORMATS.includes(text)) return { error: 'Choose a supported date format.' };
      clean.date_format = text;
    } else if (key === 'unit_system') {
      if (!['imperial', 'metric'].includes(text)) return { error: 'Choose imperial or metric.' };
      clean.unit_system = text;
    } else if (key === 'logo_url') {
      if (text.length > 3_000_000) return { error: 'That logo is too large.' };
      if (text && !text.startsWith('data:image/') && !text.startsWith('https://')) {
        return { error: 'A logo must be an uploaded image or a secure link.' };
      }
      clean.logo_url = text;
    } else if (key === 'website') {
      if (text.length > 200) return { error: 'That website address is too long.' };
      clean.website = text;
    } else if (key === 'contact_email') {
      if (text.length > 200 || (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))) {
        return { error: 'Enter a valid contact email, or leave it blank.' };
      }
      clean.contact_email = text;
    } else {
      if (text.length > 500) return { error: `That ${key.replace('_', ' ')} is too long.` };
      clean[key] = text;
    }
  }
  return { clean };
}

async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function rateLimited(res, retryAfterSeconds) {
  return res.status(429).json({
    error: 'rate_limited',
    message: 'Too many attempts — please wait and try again.',
    retry_after_seconds: retryAfterSeconds,
  });
}

export function createAuthRouter({ getPool }) {
  const router = Router();

  const requireDb = (_req, res, next) => {
    if (!getPool()) {
      return res.status(503).json({
        error: 'database_not_configured',
        detail: 'Postgres is not provisioned yet — accounts cannot be created or signed into.',
      });
    }
    return next();
  };

  const authed = (req, res, next) => {
    const pool = getPool();
    if (!pool) return res.status(401).json({ error: 'not_signed_in' });
    return requireAuth(pool)(req, res, next);
  };

  // ---- Registration -------------------------------------------------
  router.post('/auth/register', requireDb, async (req, res) => {
    const pool = getPool();
    const ip = req.ip || '';
    // 30/hour per IP: strict enough to blunt bulk account creation, loose
    // enough for a household / NAT address creating a few accounts.
    const limited = checkLimit(`register:ip:${ip}`, 30, 60 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);

    const email = normalizeEmail(req.body?.email);
    const { password } = req.body || {};
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    const pwError = passwordError(password);
    if (pwError) return res.status(400).json({ error: 'invalid_password', message: pwError });

    try {
      const result = await withTx(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        const existing = rows[0];
        if (existing?.email_verified) {
          // Ported Register page behaviour (live Base44, 2026-11-06): a
          // verified account re-registering is told plainly to sign in
          // instead — no new code is ever sent for it.
          return { status: 409, body: { error: 'already_registered', message: 'An account with this email already exists. Sign in instead.' } };
        }
        let user = existing;
        if (!user) {
          const passwordHash = await hashPassword(password);
          const id = crypto.randomUUID();
          const inserted = await client.query(
            `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
            [id, email, passwordHash],
          );
          user = inserted.rows[0];
        }
        // Re-registering an unverified account just (re)issues its code.
        const { code } = await issueOtp(client, user.id, 'verify');
        try {
          await sendMail(verificationEmail({ to: email, code }));
        } catch (error) {
          if (error instanceof EmailNotConfigured) throw error;
          throw new Error(`email_send_failed: ${error.message}`);
        }
        return { status: 201, body: { ok: true, email, requires_verification: true } };
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof EmailNotConfigured) {
        // Fail closed: nothing was created (transaction rolled back) and
        // the client is told plainly that email is not configured.
        return res.status(503).json({
          error: 'email_not_configured',
          message: 'Email is not configured, so the verification code cannot be sent. Please try again later.',
        });
      }
      if (String(error.message || '').startsWith('email_send_failed')) {
        return res.status(503).json({
          error: 'email_send_failed',
          message: 'The verification email could not be sent. Please try again later.',
        });
      }
      console.error('[twin] register failed:', error.message);
      return res.status(500).json({ error: 'registration_failed', message: 'Registration failed. Please try again.' });
    }
  });

  // ---- OTP verification (incl. Finding 28 resume path) ---------------
  router.post('/auth/verify', requireDb, async (req, res) => {
    const pool = getPool();
    const email = normalizeEmail(req.body?.email);
    const otpCode = String(req.body?.otpCode || '').trim();
    const ip = req.ip || '';
    const limited = checkLimit(`verify:${email}:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    if (!isValidEmail(email) || !/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ error: 'invalid_code', message: 'Invalid or expired verification code.' });
    }
    if (!sessionSecretConfigured()) {
      return res.status(503).json({
        error: 'auth_not_configured',
        message: 'Sessions are not configured yet (SESSION_SECRET is not set).',
      });
    }
    try {
      const result = await withTx(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = rows[0];
        if (!user) return { status: 400, body: { error: 'invalid_code', message: 'Invalid or expired verification code.' } };
        if (user.email_verified) {
          // Already verified: the code is spent. Sign in instead.
          return { status: 400, body: { error: 'already_verified', message: 'This email is already verified. Sign in instead.' } };
        }
        const check = await verifyOtpCode(client, user.id, 'verify', otpCode);
        if (!check.ok) {
          if (check.reason === 'locked') {
            return { status: 423, body: { error: 'too_many_attempts', message: 'Too many incorrect codes. Request a new code and try again.' } };
          }
          return { status: 400, body: { error: 'invalid_code', message: 'Invalid or expired verification code.' } };
        }
        await client.query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [user.id]);
        // An invited staff row for this email becomes Active on sign-in (T3).
        await activateStaffRowsForEmail(client, email);
        const session = await createSession(client, user.id, {
          userAgent: req.headers['user-agent'],
          ipAddress: ip,
        });
        const updated = await client.query('SELECT * FROM users WHERE id = $1', [user.id]);
        return { status: 200, body: { ok: true, user: publicUser(updated.rows[0]) }, sessionId: session.id };
      });
      if (result.sessionId) {
        res.cookie(SESSION_COOKIE, signSessionId(result.sessionId), cookieOptions(req));
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('[twin] verify failed:', error.message);
      return res.status(500).json({ error: 'verification_failed', message: 'Verification failed. Please try again.' });
    }
  });

  // ---- OTP resend ----------------------------------------------------
  router.post('/auth/resend-otp', requireDb, async (req, res) => {
    const pool = getPool();
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) {
      // No enumeration even for malformed input shape: same 200.
      return res.json({ ok: true });
    }
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      // No pending verification (unknown email, or already verified):
      // answer 200 anyway — never reveal which case it is.
      if (!user || user.email_verified) return res.json({ ok: true });
      const since = await secondsSinceLastOtp(pool, user.id, 'verify');
      if (since !== null && since * 1000 < OTP_RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000 - since);
        return res.status(429).json({
          error: 'resend_cooldown',
          message: `Please wait ${retryAfter} seconds before requesting a new code.`,
          retry_after_seconds: retryAfter,
        });
      }
      await withTx(pool, async (client) => {
        const { code } = await issueOtp(client, user.id, 'verify');
        await sendMail(verificationEmail({ to: email, code }));
      });
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof EmailNotConfigured) {
        return res.status(503).json({ error: 'email_not_configured', message: 'Email is not configured, so the code cannot be sent.' });
      }
      console.error('[twin] resend-otp failed:', error.message);
      return res.status(503).json({ error: 'email_send_failed', message: 'The code could not be sent. Please try again later.' });
    }
  });

  // ---- Login / logout / me -------------------------------------------
  router.post('/auth/login', requireDb, async (req, res) => {
    const pool = getPool();
    const email = normalizeEmail(req.body?.email);
    const { password } = req.body || {};
    const ip = req.ip || '';
    const limited = checkLimit(`login:${email}:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    const generic401 = () => res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
    if (!isValidEmail(email) || typeof password !== 'string') return generic401();
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      if (!user) {
        // Same bcrypt work as a real login — no timing signal.
        await dummyPasswordCheck(password);
        return generic401();
      }
      const ok = await verifyPassword(password, user.password_hash);
      // Unverified accounts get the SAME generic 401: login errors never
      // reveal whether the email exists or is verified.
      if (!ok || !user.email_verified) return generic401();
      if (!sessionSecretConfigured()) {
        return res.status(503).json({
          error: 'auth_not_configured',
          message: 'Sessions are not configured yet (SESSION_SECRET is not set).',
        });
      }
      const session = await createSession(pool, user.id, {
        userAgent: req.headers['user-agent'],
        ipAddress: ip,
      });
      // An invited staff row for this email becomes Active on sign-in (T3).
      // Never fail the login if the flip itself errors.
      try {
        await activateStaffRowsForEmail(pool, email);
      } catch (error) {
        console.error('[twin] staff activation on login failed:', error.message);
      }
      res.cookie(SESSION_COOKIE, signSessionId(session.id), cookieOptions(req));
      return res.json({ ok: true, user: publicUser(user) });
    } catch (error) {
      console.error('[twin] login failed:', error.message);
      return res.status(500).json({ error: 'login_failed', message: 'Login failed. Please try again.' });
    }
  });

  router.post('/auth/logout', async (req, res) => {
    const pool = getPool();
    const cookies = parseCookies(req);
    const signed = cookies[SESSION_COOKIE];
    if (pool && signed) {
      try {
        const sessionId = verifySignedSessionId(signed);
        if (sessionId) await revokeSession(pool, sessionId);
      } catch (error) {
        console.error('[twin] logout revoke failed:', error.message);
      }
    }
    res.cookie(SESSION_COOKIE, '', { ...cookieOptions(req), maxAge: 0 });
    return res.json({ ok: true });
  });

  router.get('/auth/me', authed, (req, res) => res.json(publicUser(req.user)));

  router.patch('/auth/me', authed, async (req, res) => {
    const pool = getPool();
    const activeBusinessId = req.body?.active_business_id ?? null;
    if (activeBusinessId !== null) {
      const { rows } = await pool.query(
        `SELECT 1 FROM business_memberships WHERE business_id = $1 AND user_id = $2`,
        [activeBusinessId, req.user.id],
      );
      if (!rows.length) {
        return res.status(403).json({ error: 'not_a_member', message: 'You are not a member of that business.' });
      }
    }
    const updated = await pool.query(
      'UPDATE users SET active_business_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [activeBusinessId, req.user.id],
    );
    return res.json(publicUser(updated.rows[0]));
  });

  // ---- Password reset -------------------------------------------------
  router.post('/auth/forgot-password', requireDb, async (req, res) => {
    const pool = getPool();
    const email = normalizeEmail(req.body?.email);
    const ip = req.ip || '';
    const limited = checkLimit(`forgot:${email}:${ip}`, 5, 60 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    // Always 200 with the same body — never reveal whether the email exists.
    if (isValidEmail(email)) {
      try {
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = rows[0];
        if (user?.email_verified) {
          const result = await withTx(pool, async (client) => {
            const { code } = await issueOtp(client, user.id, 'reset');
            const protocol = req.protocol || 'https';
            const resetUrl = `${protocol}://${req.get('host')}/reset-password?token=${code}`;
            return { code, resetUrl };
          });
          try {
            await sendMail(passwordResetEmail({ to: email, resetUrl: result.resetUrl, code: result.code }));
          } catch (error) {
            // The reset code row exists but the mail failed: log it
            // server-side (ops issue) and keep the generic 200 — the
            // caller must not learn whether the email exists.
            console.error('[twin] password-reset email failed:', error.message);
          }
        }
      } catch (error) {
        console.error('[twin] forgot-password failed:', error.message);
      }
    }
    return res.json({ ok: true });
  });

  router.post('/auth/reset-password', requireDb, async (req, res) => {
    const pool = getPool();
    const resetToken = String(req.body?.resetToken || '').trim();
    const { newPassword } = req.body || {};
    const ip = req.ip || '';
    const limited = checkLimit(`reset:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    const pwError = passwordError(newPassword);
    if (pwError) return res.status(400).json({ error: 'invalid_password', message: pwError });
    if (!/^\d{6}$/.test(resetToken)) {
      return res.status(400).json({ error: 'invalid_code', message: 'Invalid or expired reset code.' });
    }
    try {
      // The ported ResetPassword page sends only the token (no email), so
      // the live reset code is found by checking the code against the
      // live reset rows (bounded query). Brute force is bounded by the
      // per-IP rate limit above plus the 10-minute expiry and single use.
      const { rows } = await pool.query(
        `SELECT * FROM otp_codes
          WHERE purpose = 'reset' AND consumed_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 500`,
      );
      const match = rows.find((row) => {
        const candidate = hashOtpCode(resetToken, row.code_salt);
        const a = Buffer.from(candidate, 'utf8');
        const b = Buffer.from(row.code_hash, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });
      if (!match) {
        return res.status(400).json({ error: 'invalid_code', message: 'Invalid or expired reset code.' });
      }
      if (match.attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(423).json({ error: 'too_many_attempts', message: 'Too many incorrect codes. Request a new reset email and try again.' });
      }
      const result = await withTx(pool, async (client) => {
        const recheck = await verifyOtpCode(client, match.user_id, 'reset', resetToken);
        if (!recheck.ok) {
          return { status: 400, body: { error: 'invalid_code', message: 'Invalid or expired reset code.' } };
        }
        const passwordHash = await hashPassword(newPassword);
        await client.query(
          `UPDATE users SET password_hash = $1, email_verified = TRUE, updated_at = NOW() WHERE id = $2`,
          [passwordHash, match.user_id],
        );
        // Logout-everywhere: every session dies on password change.
        await revokeAllSessions(client, match.user_id);
        return { status: 200, body: { ok: true } };
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('[twin] reset-password failed:', error.message);
      return res.status(500).json({ error: 'reset_failed', message: 'Password reset failed. Please try again.' });
    }
  });

  // ---- Businesses ------------------------------------------------------
  router.get('/businesses', authed, async (req, res) => {
    const pool = getPool();
    try {
      const { rows } = await pool.query(
        `SELECT b.* FROM businesses b
           JOIN business_memberships m ON m.business_id = b.id
          WHERE m.user_id = $1
          ORDER BY b.created_at ASC`,
        [req.user.id],
      );
      return res.json({ items: rows.map(publicBusiness), total: rows.length });
    } catch (error) {
      console.error('[twin] list businesses failed:', error.message);
      return res.status(500).json({ error: 'list_failed', message: 'Could not list businesses.' });
    }
  });

  router.post('/businesses', authed, async (req, res) => {
    const pool = getPool();
    const name = String(req.body?.name || '').trim();
    const tagline = String(req.body?.tagline || '').trim();
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase();
    if (!name || name.length > 120) {
      return res.status(400).json({ error: 'invalid_name', message: 'Enter a business name (up to 120 characters).' });
    }
    try {
      let planLimit = ESSENTIALS_BUSINESS_LIMIT;
      const business = await withTx(pool, async (client) => {
        const owned = await client.query(
          'SELECT id FROM businesses WHERE owner_id = $1 ORDER BY created_at ASC',
          [req.user.id],
        );
        // The business limit belongs to the login, and the plan belongs
        // to a business: the OLDEST workspace the login owns decides
        // (plan §5.2 businessLimitFor). No entitlement row yet means
        // restricted Essentials (1 business) — never Business.
        let limit = ESSENTIALS_BUSINESS_LIMIT;
        if (owned.rows.length) {
          const entitlement = await client.query(
            'SELECT plan FROM entitlements WHERE business_id = $1 LIMIT 1',
            [owned.rows[0].id],
          );
          limit = entitlement.rows[0]?.plan === 'business' ? 5 : 1;
          planLimit = limit;
        }
        if (owned.rows.length >= limit) {
          return null;
        }
        const id = crypto.randomUUID();
        const inserted = await client.query(
          `INSERT INTO businesses (id, owner_id, name, tagline, currency, created_by_id)
           VALUES ($1, $2, $3, $4, $5, $2) RETURNING *`,
          [id, req.user.id, name, tagline, currency],
        );
        await client.query(
          `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id)
           VALUES ($1, $2, $3, 'owner', $3)`,
          [crypto.randomUUID(), id, req.user.id],
        );
        return inserted.rows[0];
      });
      if (!business) {
        return res.status(403).json({
          error: 'business_limit_reached',
          message: `Your plan allows ${planLimit} ${planLimit === 1 ? 'business' : 'businesses'}. Upgrade to Business in a later phase to add more.`,
        });
      }
      return res.status(201).json(publicBusiness(business));
    } catch (error) {
      console.error('[twin] create business failed:', error.message);
      return res.status(500).json({ error: 'create_failed', message: 'Could not create the business.' });
    }
  });

  // T6: Settings save — the business identity (name, logo, brand
  // color, contact details, language...). Owner-only; the app name is
  // never part of this payload and cannot be changed here. This is
  // what entities.Business.update maps to on the client — before T6
  // it rejected as not-implemented, so no Settings save could land.
  router.patch('/businesses/:id', authed, async (req, res) => {
    const pool = getPool();
    try {
      const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [req.params.id]);
      const business = rows[0];
      if (!business) return res.status(404).json({ error: 'not_found', message: 'Business not found.' });
      if (business.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'forbidden', message: 'Only the business owner can change these settings.' });
      }
      const { clean, error } = validateBusinessPatch(req.body || {});
      if (error) return res.status(400).json({ error: 'invalid_value', message: error });
      const columns = Object.keys(clean);
      if (!columns.length) return res.json(publicBusiness(business));
      const sets = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
      const updated = await pool.query(
        `UPDATE businesses SET ${sets}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
        [...columns.map((col) => clean[col]), req.params.id],
      );
      return res.json(publicBusiness(updated.rows[0]));
    } catch (error) {
      console.error('[twin] update business failed:', error.message);
      return res.status(500).json({ error: 'update_failed', message: 'Could not save your settings.' });
    }
  });

  router.post('/businesses/:id/switch', authed, async (req, res) => {
    const pool = getPool();
    const businessId = req.params.id;
    const { rows } = await pool.query(
      'SELECT 1 FROM business_memberships WHERE business_id = $1 AND user_id = $2',
      [businessId, req.user.id],
    );
    if (!rows.length) {
      return res.status(403).json({ error: 'not_a_member', message: 'You are not a member of that business.' });
    }
    const updated = await pool.query(
      'UPDATE users SET active_business_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [businessId, req.user.id],
    );
    return res.json({ ok: true, active_business_id: businessId, user: publicUser(updated.rows[0]) });
  });

  return router;
}

/** Test helper — resets the in-memory rate limits. Never used in production. */
export function __resetAuthRateLimits() {
  resetRateLimits();
}
