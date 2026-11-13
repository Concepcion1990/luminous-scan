/**
 * Emailed OTP verification codes — T2.
 *
 * Rules (plan §4.3, task spec):
 * - 6 digits, cryptographically random, 10-minute expiry, single-use.
 * - HASHED in the DB (SHA-256 of a per-code random salt + the code) —
 *   a plaintext code is never stored and never logged.
 * - Max 5 attempts per code, then the code is locked out.
 * - Resend cooldown: 60 seconds per user + purpose.
 * - Purposes: 'verify' (email verification after registration) and
 *   'reset' (password reset; the code doubles as the reset token in
 *   the emailed link, per the ported ResetPassword page's ?token=).
 *
 * The recovery kit (011) reuses these exact mechanics against its
 * own table, `account_codes`, so the T2 purpose CHECK on otp_codes
 * is never widened: pass { table: 'account_codes' } for the kit's
 * purposes ('backup_email', 'recover', 'change_email'). The table
 * name is a server-side constant — an allowlist guards the SQL.
 */
import crypto from 'node:crypto';

const CODE_TABLES = new Set(['otp_codes', 'account_codes']);

function codeTable(table) {
  return CODE_TABLES.has(table) ? table : 'otp_codes';
}

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashOtpCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issue a fresh code for (user, purpose). Any live codes for the same
 * purpose are superseded (they stay in the table but are ignored — the
 * newest unconsumed, unexpired code is the only valid one).
 * Returns { id, code, expiresAt } — the caller sends `code` by email.
 * The code is NEVER written to a log.
 */
export async function issueOtp(client, userId, purpose, { table = 'otp_codes' } = {}) {
  const code = generateOtpCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtpCode(code, salt);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await client.query(
    `INSERT INTO ${codeTable(table)} (id, user_id, purpose, code_hash, code_salt, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, purpose, codeHash, salt, expiresAt.toISOString()],
  );
  return { id, code, expiresAt };
}

/** Seconds since the newest code for (user, purpose) was created, or null. */
export async function secondsSinceLastOtp(client, userId, purpose, { table = 'otp_codes' } = {}) {
  const { rows } = await client.query(
    `SELECT created_at FROM ${codeTable(table)}
      WHERE user_id = $1 AND purpose = $2
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  if (!rows.length) return null;
  return (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
}

/**
 * Verify a code. Returns { ok: true, otp } on success (and consumes
 * the code), or { ok: false, reason } where reason is one of
 * 'invalid' | 'expired' | 'locked' | 'not_found'. Callers map every
 * reason to the same generic message — the reason exists so the
 * server can log and rate-limit correctly, never to tell the caller
 * which part was wrong.
 */
export async function verifyOtpCode(client, userId, purpose, code, { table = 'otp_codes' } = {}) {
  const tbl = codeTable(table);
  const { rows } = await client.query(
    `SELECT * FROM ${tbl}
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  const otp = rows[0];
  if (!otp) return { ok: false, reason: 'not_found' };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (new Date(otp.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  const candidate = hashOtpCode(String(code).trim(), otp.code_salt);
  if (!timingSafeEqual(candidate, otp.code_hash)) {
    await client.query(`UPDATE ${tbl} SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    const attempts = otp.attempts + 1;
    return { ok: false, reason: attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid' };
  }
  await client.query(`UPDATE ${tbl} SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
  return { ok: true, otp };
}

/** Consume any live code for (user, purpose) — used when a newer code supersedes it. */
export async function invalidateLiveOtps(client, userId, purpose, { table = 'otp_codes' } = {}) {
  await client.query(
    `UPDATE ${codeTable(table)} SET consumed_at = NOW()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  );
}
