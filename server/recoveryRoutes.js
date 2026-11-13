/**
 * Account recovery kit — HTTP surface (T7 / migration 011).
 *
 *   GET  /api/account/security                    spare-key status
 *   POST /api/account/backup-codes                (re)generate spare keys
 *   POST /api/account/backup-email                start backup-email setup
 *   POST /api/account/backup-email/verify         confirm the backup email
 *   POST /api/account/change-email/request        start a change (code to the NEW email)
 *   POST /api/account/change-email/confirm        finish the change (THE carry)
 *   POST /api/auth/recover                        spare-key entry: backup code, or ask for a code to the backup email
 *   POST /api/auth/recover/verify                 backup-email code -> restricted recovery session
 *   POST /api/businesses/:bid/staff/:id/email     owner fixes a staff member's email
 *
 * Rules that hold everywhere here:
 *   - Sign-in stays email + password only. Recovery NEVER mints a
 *     full session: it mints a short-lived scope='recovery' session
 *     that can reach ONLY the change-email flow (server/app.js
 *     enforces the allowlist), which graduates to a full session
 *     when — and only when — the email change completes.
 *   - No enumeration: the pre-auth recovery answers are identical
 *     whether or not the account (or its backup email) exists.
 *   - Codes are the T2 OTP mechanics (server/otp.js over the
 *     account_codes table): 6 digits, 10 minutes, 5 attempts then
 *     lockout, 60-second resend cooldown. Backup-code attempts are
 *     bounded by per-email+IP rate limits.
 *   - An email change never mints a second free trial: trial_history
 *     is carried/merged in the same transaction (server/recovery.js).
 */
import { Router } from 'express';
import { getPool } from './db.js';
import { verifyPassword } from './passwords.js';
import { checkLimit } from './rateLimit.js';
import {
  sendMail,
  EmailNotConfigured,
  backupEmailCodeEmail,
  accountRecoveryCodeEmail,
  newEmailCodeEmail,
  emailChangedNoticeEmail,
} from './email.js';
import {
  issueOtp,
  secondsSinceLastOtp,
  verifyOtpCode,
  invalidateLiveOtps,
  OTP_RESEND_COOLDOWN_MS,
} from './otp.js';

const OTP_RESEND_COOLDOWN_SECONDS = OTP_RESEND_COOLDOWN_MS / 1000;
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  requireAuth,
  revokeOtherSessions,
  graduateSession,
  sessionSecretConfigured,
  signSessionId,
} from './sessions.js';
import { withTx, assertNotInGrace } from './billing.js';
import { resolveAccess } from './authz.js';
import { staffMemberPublic } from './staff.js';
import {
  generateBackupCodes,
  countUnusedBackupCodes,
  consumeBackupCode,
  applyEmailChange,
  mergeTrialHistory,
  syncStripeCustomerEmail,
  maskEmail,
} from './recovery.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_CODES = { table: 'account_codes' };

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
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

function rateLimited(res, retryAfterSeconds) {
  return res.status(429).json({
    error: 'rate_limited',
    message: 'Too many attempts — please wait and try again.',
    retry_after_seconds: retryAfterSeconds,
  });
}

function shaped(res, error, fallbackCode, fallbackMessage) {
  if (error && typeof error.status === 'number') {
    return res.status(error.status).json({ error: error.code || fallbackCode, message: error.message });
  }
  console.error('[twin] recovery failed:', error?.message || error);
  return res.status(500).json({ error: fallbackCode, message: fallbackMessage });
}

/** Post-change notices: old address + verified backup (best-effort). */
async function sendChangeNotices(pool, userId, oldEmail, newEmail) {
  const targets = new Set([oldEmail]);
  try {
    const { rows } = await pool.query(
      'SELECT backup_email, backup_email_verified FROM users WHERE id = $1',
      [userId],
    );
    const backup = rows[0]?.backup_email_verified ? rows[0]?.backup_email : null;
    if (backup && backup.toLowerCase() !== oldEmail && backup.toLowerCase() !== newEmail) {
      targets.add(backup.toLowerCase());
    }
  } catch (error) {
    console.error('[twin] recovery notice lookup failed:', error.message);
  }
  for (const to of targets) {
    try {
      await sendMail(emailChangedNoticeEmail({ to, newEmail }));
    } catch (error) {
      // A notice must never fail the change itself — log and move on.
      console.error(`[twin] email-change notice to previous address failed (${error.code || error.message})`);
    }
  }
}

export function createRecoveryRouter({ getPool: getPoolOverride } = {}) {
  const poolOf = getPoolOverride || getPool;
  const router = Router();

  const requireDb = (_req, res, next) => {
    if (!poolOf()) {
      return res.status(503).json({
        error: 'database_not_configured',
        detail: 'Postgres is not provisioned yet — accounts cannot be created or signed into.',
      });
    }
    return next();
  };

  const authed = (req, res, next) => {
    const pool = poolOf();
    if (!pool) return res.status(401).json({ error: 'not_signed_in' });
    return requireAuth(pool)(req, res, next);
  };

  const loadUser = async (pool, userId) => {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return rows[0] || null;
  };

  // ---- Spare-key status ---------------------------------------------
  router.get('/account/security', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    try {
      const user = await loadUser(pool, req.user.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      const remaining = await countUnusedBackupCodes(pool, req.user.id);
      return res.json({
        email: user.email,
        backup_email: user.backup_email_verified ? maskEmail(user.backup_email) : null,
        backup_email_verified: Boolean(user.backup_email_verified),
        backup_email_pending: Boolean(user.pending_backup_email),
        backup_codes_remaining: remaining,
      });
    } catch (error) {
      return shaped(res, error, 'security_failed', 'Could not load your security settings.');
    }
  });

  // ---- Backup codes ---------------------------------------------------
  router.post('/account/backup-codes', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const limited = checkLimit(`backup-codes:${req.user.id}`, 5, 60 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    try {
      const codes = await withTx(pool, (client) => generateBackupCodes(client, req.user.id));
      // Plaintext exists only in this response — shown once, never stored.
      return res.json({ ok: true, codes, remaining: codes.length });
    } catch (error) {
      return shaped(res, error, 'backup_codes_failed', 'Could not generate backup codes.');
    }
  });

  // ---- Backup email ---------------------------------------------------
  router.post('/account/backup-email', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    try {
      const user = await loadUser(pool, req.user.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      if (email === String(user.email).toLowerCase()) {
        return res.status(400).json({
          error: 'backup_same_as_account',
          message: 'Your backup email must be different from your account email — it is the spare key for when this email is out of reach.',
        });
      }
      if (user.backup_email_verified && email === String(user.backup_email || '').toLowerCase()) {
        return res.status(400).json({ error: 'backup_already_set', message: 'That address is already your verified backup email.' });
      }
      const since = await secondsSinceLastOtp(pool, req.user.id, 'backup_email', ACCOUNT_CODES);
      if (since !== null && since < OTP_RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: 'resend_too_soon',
          message: 'A code was just sent — wait a moment before asking for another.',
          retry_after_seconds: OTP_RESEND_COOLDOWN_SECONDS - since,
        });
      }
      const issued = await withTx(pool, async (client) => {
        await client.query('UPDATE users SET pending_backup_email = $2 WHERE id = $1', [req.user.id, email]);
        await invalidateLiveOtps(client, req.user.id, 'backup_email', ACCOUNT_CODES);
        return issueOtp(client, req.user.id, 'backup_email', ACCOUNT_CODES);
      });
      try {
        await sendMail(backupEmailCodeEmail({ to: email, code: issued.code }));
      } catch (error) {
        if (error instanceof EmailNotConfigured || error.code === 'email_not_configured') {
          return res.status(503).json({ error: 'email_not_configured', message: 'Email is not configured yet, so the code cannot be sent.' });
        }
        throw error;
      }
      return res.json({ ok: true, pending: true });
    } catch (error) {
      return shaped(res, error, 'backup_email_failed', 'Could not start the backup email setup.');
    }
  });

  router.post('/account/backup-email/verify', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const code = String(req.body?.code || '').trim();
    try {
      const user = await loadUser(pool, req.user.id);
      if (!user?.pending_backup_email) {
        return res.status(400).json({ error: 'no_pending_backup_email', message: 'Enter a backup email first — the code goes to that address.' });
      }
      const verdict = await verifyOtpCode(pool, req.user.id, 'backup_email', code, ACCOUNT_CODES);
      if (!verdict.ok) {
        if (verdict.reason === 'locked') {
          return res.status(423).json({ error: 'too_many_attempts', message: 'Too many wrong codes. Request a fresh code and try again.' });
        }
        return res.status(400).json({ error: 'invalid_code', message: 'That code does not match, or it has expired. Codes last 10 minutes.' });
      }
      await pool.query(
        'UPDATE users SET backup_email = pending_backup_email, backup_email_verified = TRUE, pending_backup_email = NULL WHERE id = $1',
        [req.user.id],
      );
      return res.json({ ok: true, backup_email_verified: true });
    } catch (error) {
      return shaped(res, error, 'backup_email_verify_failed', 'Could not verify the backup email.');
    }
  });

  // ---- Change email (signed-in path AND recovery graduation) ---------
  router.post('/account/change-email/request', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const newEmail = normalizeEmail(req.body?.new_email ?? req.body?.email);
    const { password } = req.body || {};
    if (!isValidEmail(newEmail)) {
      return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    try {
      const user = await loadUser(pool, req.user.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      // A full session proves itself with the account password. A
      // recovery session already proved itself with a spare key —
      // that IS its authentication, and it can reach nothing else.
      if (req.sessionScope !== 'recovery') {
        if (typeof password !== 'string' || !(await verifyPassword(password, user.password_hash))) {
          return res.status(401).json({ error: 'invalid_password', message: 'Your current password does not match.' });
        }
      }
      if (newEmail === String(user.email).toLowerCase()) {
        return res.status(400).json({ error: 'same_email', message: 'That is already the email on this account.' });
      }
      const { rows: clash } = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [newEmail, req.user.id]);
      if (clash.length) {
        return res.status(409).json({
          error: 'email_in_use',
          message: 'Another account already uses that email. Use a different email, or sign in to that account instead.',
        });
      }
      const since = await secondsSinceLastOtp(pool, req.user.id, 'change_email', ACCOUNT_CODES);
      if (since !== null && since < OTP_RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: 'resend_too_soon',
          message: 'A code was just sent — wait a moment before asking for another.',
          retry_after_seconds: OTP_RESEND_COOLDOWN_SECONDS - since,
        });
      }
      const issued = await withTx(pool, async (client) => {
        await client.query('UPDATE users SET pending_new_email = $2 WHERE id = $1', [req.user.id, newEmail]);
        await invalidateLiveOtps(client, req.user.id, 'change_email', ACCOUNT_CODES);
        return issueOtp(client, req.user.id, 'change_email', ACCOUNT_CODES);
      });
      try {
        await sendMail(newEmailCodeEmail({ to: newEmail, code: issued.code }));
      } catch (error) {
        if (error instanceof EmailNotConfigured || error.code === 'email_not_configured') {
          return res.status(503).json({ error: 'email_not_configured', message: 'Email is not configured yet, so the code cannot be sent.' });
        }
        throw error;
      }
      return res.json({ ok: true, sent_to: newEmail });
    } catch (error) {
      return shaped(res, error, 'change_email_request_failed', 'Could not start the email change.');
    }
  });

  router.post('/account/change-email/confirm', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const code = String(req.body?.code || '').trim();
    try {
      const user = await loadUser(pool, req.user.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      if (!user.pending_new_email) {
        return res.status(400).json({ error: 'no_pending_email_change', message: 'Start the email change first — the code goes to the new address.' });
      }
      const verdict = await verifyOtpCode(pool, req.user.id, 'change_email', code, ACCOUNT_CODES);
      if (!verdict.ok) {
        if (verdict.reason === 'locked') {
          return res.status(423).json({ error: 'too_many_attempts', message: 'Too many wrong codes. Request a fresh code and try again.' });
        }
        return res.status(400).json({ error: 'invalid_code', message: 'That code does not match, or it has expired. Codes last 10 minutes.' });
      }
      const wasRecovery = req.sessionScope === 'recovery';
      const { oldEmail, newEmail } = await withTx(pool, async (client) => {
        const carried = await applyEmailChange(client, req.user.id, user.pending_new_email);
        // Every OTHER door closes; this session stays — and a
        // recovery session graduates to a normal one, because its
        // one job is done.
        await revokeOtherSessions(client, req.user.id, req.sessionId);
        if (wasRecovery) await graduateSession(client, req.sessionId);
        return carried;
      });
      await sendChangeNotices(pool, req.user.id, oldEmail, newEmail);
      await syncStripeCustomerEmail(pool, req.user.id, oldEmail, newEmail);
      const fresh = await loadUser(pool, req.user.id);
      return res.json({ ok: true, user: { ...publicUser(fresh), session_scope: 'full' } });
    } catch (error) {
      return shaped(res, error, 'change_email_failed', 'Could not change the email.');
    }
  });

  // ---- Recovery entry (pre-auth) --------------------------------------
  router.post('/auth/recover', requireDb, async (req, res) => {
    const pool = poolOf();
    const email = normalizeEmail(req.body?.email);
    const backupCode = typeof req.body?.backup_code === 'string' ? req.body.backup_code : '';
    const ip = req.ip || '';
    const limited = checkLimit(`recover:${email}:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
      const user = rows[0] || null;

      if (backupCode.trim()) {
        // Spare-key entry. One generic refusal covers "no such
        // account" and "wrong code" alike — no enumeration.
        const ok = user
          ? await withTx(pool, (client) => consumeBackupCode(client, user.id, backupCode))
          : false;
        if (!ok) {
          return res.status(400).json({
            error: 'recovery_failed',
            message: 'That email and spare key do not match. Check both and try again — or use the backup-email code instead.',
          });
        }
        if (!sessionSecretConfigured()) {
          return res.status(503).json({ error: 'auth_not_configured', message: 'Sessions are not configured yet (SESSION_SECRET is not set).' });
        }
        const session = await createSession(pool, user.id, {
          userAgent: req.headers['user-agent'],
          ipAddress: ip,
          scope: 'recovery',
        });
        res.cookie(SESSION_COOKIE, signSessionId(session.id), cookieOptions(req));
        return res.json({ ok: true, recovery: true });
      }

      // Code-to-backup-email entry. The answer is ALWAYS the same,
      // whether the account exists, has a backup email, or neither —
      // and a code is only ever sent to a VERIFIED backup address.
      if (user?.backup_email_verified && user.backup_email) {
        const since = await secondsSinceLastOtp(pool, user.id, 'recover', ACCOUNT_CODES);
        if (since === null || since >= OTP_RESEND_COOLDOWN_SECONDS) {
          try {
            const issued = await withTx(pool, async (client) => {
              await invalidateLiveOtps(client, user.id, 'recover', ACCOUNT_CODES);
              return issueOtp(client, user.id, 'recover', ACCOUNT_CODES);
            });
            await sendMail(accountRecoveryCodeEmail({ to: user.backup_email, code: issued.code }));
          } catch (error) {
            // Still the same outward answer — but log it; a configured
            // mailer failing is an operations problem, not a user one.
            console.error('[twin] recovery code send failed:', error.message);
          }
        }
      }
      return res.json({ ok: true });
    } catch (error) {
      return shaped(res, error, 'recovery_failed', 'Recovery could not be started. Please try again.');
    }
  });

  router.post('/auth/recover/verify', requireDb, async (req, res) => {
    const pool = poolOf();
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const ip = req.ip || '';
    const limited = checkLimit(`recover-verify:${email}:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return rateLimited(res, limited.retryAfterSeconds);
    const genericInvalid = () => res.status(400).json({
      error: 'invalid_code',
      message: 'That code does not match, or it has expired. Codes last 10 minutes — you can request a new one.',
    });
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
      const user = rows[0] || null;
      if (!user) return genericInvalid();
      const verdict = await verifyOtpCode(pool, user.id, 'recover', code, ACCOUNT_CODES);
      if (!verdict.ok) {
        if (verdict.reason === 'locked') {
          return res.status(423).json({
            error: 'too_many_attempts',
            message: 'Too many wrong codes — this recovery is locked. Wait a while, then request a fresh code.',
          });
        }
        return genericInvalid();
      }
      if (!sessionSecretConfigured()) {
        return res.status(503).json({ error: 'auth_not_configured', message: 'Sessions are not configured yet (SESSION_SECRET is not set).' });
      }
      const session = await createSession(pool, user.id, {
        userAgent: req.headers['user-agent'],
        ipAddress: ip,
        scope: 'recovery',
      });
      res.cookie(SESSION_COOKIE, signSessionId(session.id), cookieOptions(req));
      return res.json({ ok: true, recovery: true });
    } catch (error) {
      return shaped(res, error, 'recovery_failed', 'Recovery could not be completed. Please try again.');
    }
  });

  // ---- Owner fixes a staff member's email -----------------------------
  router.post('/businesses/:bid/staff/:memberId/email', requireDb, authed, async (req, res) => {
    const pool = poolOf();
    const businessId = req.params.bid;
    const memberId = req.params.memberId;
    const newEmail = normalizeEmail(req.body?.email);
    try {
      const access = await resolveAccess(pool, req.user, businessId);
      if (!access) return res.status(404).json({ error: 'business_not_found' });
      if (!access.isOwner) {
        return res.status(403).json({
          error: 'owner_only',
          message: "Only the business owner can change a team member's email — it moves their whole account with it.",
        });
      }
      await assertNotInGrace(pool, businessId);
      const { rows: memberRows } = await pool.query(
        'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2',
        [memberId, businessId],
      );
      const member = memberRows[0];
      if (!member) return res.status(404).json({ error: 'staff_not_found', message: 'That team member is not on this business.' });
      if (!isValidEmail(newEmail)) {
        return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
      }
      const oldEmail = String(member.email).toLowerCase();
      if (newEmail === oldEmail) {
        return res.json({ ok: true, member: staffMemberPublic(member), unchanged: true });
      }
      const { rows: seatClash } = await pool.query(
        'SELECT id FROM staff_members WHERE business_id = $1 AND LOWER(email) = $2 AND id <> $3',
        [businessId, newEmail, memberId],
      );
      if (seatClash.length) {
        return res.status(409).json({
          error: 'staff_exists',
          message: 'Another team member on this business already uses that email.',
        });
      }

      const { rows: oldAccounts } = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [oldEmail]);
      const account = oldAccounts[0] || null;
      const { rows: newAccounts } = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [newEmail]);
      const newAccount = newAccounts[0] || null;

      if (account && newAccount && newAccount.id !== account.id) {
        return res.status(409).json({
          error: 'email_in_use',
          message: 'That email already belongs to a different registered account. Nothing was changed.',
        });
      }
      if (!account && newAccount) {
        // The row is a bare invite, but the new address is somebody
        // else's account — moving the row would hand that account
        // this seat. Refuse; the owner can invite the right address.
        return res.status(409).json({
          error: 'email_in_use',
          message: "That email belongs to a registered account already. Invite that account's owner with the Staff form instead — nothing was changed.",
        });
      }

      if (account) {
        // RULE (see server/recovery.js): the staff row belongs to a
        // real account, so this is an ACCOUNT email change — the
        // whole carry runs: users.email, ALL of the person's staff
        // rows in every business, and trial_history, atomically.
        // Their other jobs follow the account; nobody keeps access
        // under the old email and nobody gains a duplicate account.
        // Live sessions keep working: the email is read fresh from
        // the users row on every request.
        const carried = await withTx(pool, (client) => applyEmailChange(client, account.id, newEmail));
        await sendChangeNotices(pool, account.id, carried.oldEmail, carried.newEmail);
        await syncStripeCustomerEmail(pool, account.id, carried.oldEmail, carried.newEmail);
      } else {
        // No account exists under the old email (an invite that was
        // never accepted): only THIS business's row is the owner's
        // to move. Trial history still merges — a wiped account's
        // history outlives it, and it must not mint a fresh trial.
        await withTx(pool, async (client) => {
          await client.query('UPDATE staff_members SET email = $2 WHERE id = $1', [memberId, newEmail]);
          await mergeTrialHistory(client, oldEmail, newEmail);
        });
      }
      const { rows: freshRows } = await pool.query('SELECT * FROM staff_members WHERE id = $1', [memberId]);
      return res.json({ ok: true, member: staffMemberPublic(freshRows[0]) });
    } catch (error) {
      return shaped(res, error, 'staff_email_failed', "Could not change the team member's email.");
    }
  });

  return router;
}
