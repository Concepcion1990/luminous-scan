/**
 * T2 auth tests — register / OTP verify / login / logout / password
 * reset, run against the real Express app + pg-mem Postgres with an
 * in-memory mail sink. No live Postgres, no real email.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  base,
  pool,
  mailbox,
  req,
  cookieFrom,
  codeFromMail,
  resetCodeFromMail,
  mailTo,
  registerVerifiedUser,
  login,
  resetRateLimits,
  close,
} from './helpers.js';
import { cookieOptions } from '../../server/sessions.js';

after(close);

// Rate limits are per-IP and the whole suite shares 127.0.0.1: reset
// them between tests so each test proves its own limiter behaviour.
beforeEach(() => resetRateLimits());

test('register validation rejects a bad email and a short password', async () => {
  const badEmail = await req('/api/auth/register', {
    method: 'POST',
    body: { email: 'not-an-email', password: 'CorrectHorse123' },
  });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.json.error, 'invalid_email');

  const shortPw = await req('/api/auth/register', {
    method: 'POST',
    body: { email: 'short-pw@example.com', password: 'short' },
  });
  assert.equal(shortPw.status, 400);
  assert.equal(shortPw.json.error, 'invalid_password');
});

test('register stores a bcrypt hash (never plaintext) and mails a 6-digit code', async () => {
  const email = 'hash-check@example.com';
  const password = 'CorrectHorse123';
  const res = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 201);
  assert.equal(res.json.requires_verification, true);

  const row = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
  assert.ok(row, 'user row exists');
  assert.equal(row.email_verified, false);
  assert.match(row.password_hash, /^\$2[aby]\$/);
  assert.notEqual(row.password_hash, password);
  assert.ok(!String(row.password_hash).includes(password));

  // No paid access of any kind is created by registration (T4 owns billing):
  // the billing tables do not even exist yet in T2.
  await assert.rejects(pool.query('SELECT 1 FROM entitlements LIMIT 1'));
  await assert.rejects(pool.query('SELECT 1 FROM subscriptions LIMIT 1'));

  const mail = mailTo(email, 'verification code');
  assert.ok(mail, 'verification email captured by the sink');
  const code = codeFromMail(mail);
  assert.match(code, /^\d{6}$/);

  // The code itself is never stored plaintext: only a hash + salt.
  const otp = (await pool.query('SELECT * FROM otp_codes WHERE user_id = $1', [row.id])).rows[0];
  assert.ok(otp);
  assert.equal(otp.code_hash.length, 64);
  assert.notEqual(otp.code_hash, code);
  assert.ok(!JSON.stringify(otp).includes(code));
});

test('registering an already-verified email says so plainly and sends no code', async () => {
  const { email, password } = await registerVerifiedUser('dup-verified@example.com');
  const before = mailbox.length;
  const res = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 409);
  assert.match(res.json.message, /already exists/i);
  assert.equal(mailbox.length, before, 'no new code mailed for a verified account');
});

test('re-registering an unverified email re-issues its code', async () => {
  const email = 'dup-unverified@example.com';
  const first = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'CorrectHorse123' },
  });
  assert.equal(first.status, 201);
  const second = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'CorrectHorse123' },
  });
  assert.equal(second.status, 201);
  assert.equal(second.json.requires_verification, true);
});

test('OTP verify: wrong code fails generically, correct code logs in, code is single-use', async () => {
  const email = 'otp-flow@example.com';
  await req('/api/auth/register', { method: 'POST', body: { email, password: 'CorrectHorse123' } });
  const code = codeFromMail(mailTo(email, 'verification code'));

  const wrong = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: '000000' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'invalid_code');
  assert.match(wrong.json.message, /invalid or expired/i);

  const attempts = (await pool.query('SELECT attempts FROM otp_codes WHERE user_id = (SELECT id FROM users WHERE email = $1) ORDER BY created_at DESC LIMIT 1', [email])).rows[0];
  assert.equal(attempts.attempts, 1);

  const good = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  assert.equal(good.status, 200);
  assert.equal(good.json.user.email_verified, true);
  assert.ok(good.setCookie, 'session cookie is set on verify');
  assert.match(good.setCookie, /HttpOnly/i);
  assert.match(good.setCookie, /SameSite=Lax/i);
  assert.match(good.setCookie, /^twin_session=/);

  const me = await req('/api/auth/me', { cookie: cookieFrom(good.setCookie) });
  assert.equal(me.status, 200);
  assert.equal(me.json.email, email);

  const reuse = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  // The account is verified now, so the code is spent: re-verifying is
  // told plainly to sign in instead (same 400 family, no enumeration).
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, 'already_verified');
});

test('OTP verify: an expired code is rejected', async () => {
  const email = 'otp-expired@example.com';
  await req('/api/auth/register', { method: 'POST', body: { email, password: 'CorrectHorse123' } });
  const code = codeFromMail(mailTo(email, 'verification code'));
  await pool.query(
    "UPDATE otp_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
    [email],
  );
  const res = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'invalid_code');
});

test('OTP verify: 5 wrong attempts lock the code out', async () => {
  const email = 'otp-lockout@example.com';
  await req('/api/auth/register', { method: 'POST', body: { email, password: 'CorrectHorse123' } });
  let last;
  for (let i = 0; i < 5; i++) {
    last = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: '111111' } });
  }
  assert.equal(last.status, 423);
  assert.equal(last.json.error, 'too_many_attempts');
  // Even the right code no longer works once locked.
  const code = codeFromMail(mailTo(email, 'verification code'));
  const afterLock = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  assert.equal(afterLock.status, 423);
});

test('OTP resend: 60-second cooldown, then a fresh code supersedes the old one', async () => {
  const email = 'otp-resend@example.com';
  await req('/api/auth/register', { method: 'POST', body: { email, password: 'CorrectHorse123' } });
  const firstCode = codeFromMail(mailTo(email, 'verification code'));

  const tooSoon = await req('/api/auth/resend-otp', { method: 'POST', body: { email } });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.json.error, 'resend_cooldown');
  assert.ok(tooSoon.json.retry_after_seconds > 0 && tooSoon.json.retry_after_seconds <= 60);

  await pool.query(
    "UPDATE otp_codes SET created_at = NOW() - INTERVAL '61 seconds' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
    [email],
  );
  const resent = await req('/api/auth/resend-otp', { method: 'POST', body: { email } });
  assert.equal(resent.status, 200);
  const mails = mailbox.filter((m) => m.to === email && m.subject.includes('verification code'));
  assert.equal(mails.length, 2);
  const secondCode = codeFromMail(mails[1]);
  assert.notEqual(secondCode, firstCode);

  const oldCode = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: firstCode } });
  assert.equal(oldCode.status, 400);
  const newCode = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: secondCode } });
  assert.equal(newCode.status, 200);
});

test('resend-otp never enumerates: unknown and verified emails both get 200', async () => {
  const unknown = await req('/api/auth/resend-otp', { method: 'POST', body: { email: 'nobody-here@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.ok, true);
  const { email } = await registerVerifiedUser('resend-verified@example.com');
  const verified = await req('/api/auth/resend-otp', { method: 'POST', body: { email } });
  assert.equal(verified.status, 200);
});

test('login: same generic 401 for unknown email, wrong password, and unverified account', async () => {
  const unknown = await login('ghost@example.com', 'Whatever123');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.error, 'invalid_credentials');

  const { email, password } = await registerVerifiedUser('login-ok@example.com');
  const wrongPw = await login(email, 'NotThePassword1');
  assert.equal(wrongPw.status, 401);
  assert.deepEqual(wrongPw.json, unknown.json);

  const unverifiedEmail = 'login-unverified@example.com';
  await req('/api/auth/register', { method: 'POST', body: { email: unverifiedEmail, password: 'CorrectHorse123' } });
  const unverified = await login(unverifiedEmail, 'CorrectHorse123');
  assert.equal(unverified.status, 401);
  assert.deepEqual(unverified.json, unknown.json);
});

test('login success sets a session cookie; logout revokes it; me flips 200 -> 401', async () => {
  const { email, password } = await registerVerifiedUser('login-logout@example.com');
  const res = await login(email, password);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.email, email);
  const cookie = cookieFrom(res.setCookie);
  assert.ok(cookie);

  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200);

  const logout = await req('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 200);
  assert.equal(logout.json.ok, true);

  const after = await req('/api/auth/me', { cookie });
  assert.equal(after.status, 401);
  assert.equal(after.json.error, 'not_signed_in');
});

test('login rate limit: 10 failed attempts per email+IP, then 429', async () => {
  const email = 'rate-limit-login@example.com';
  let last;
  for (let i = 0; i < 11; i++) {
    last = await login(email, 'WrongPassword1');
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
});

test('password reset: unknown email gets the same 200 and no mail; bad token is generic', async () => {
  const before = mailbox.length;
  const unknown = await req('/api/auth/forgot-password', { method: 'POST', body: { email: 'ghost-reset@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.ok, true);
  assert.equal(mailbox.length, before, 'no mail for an unknown email');

  const bad = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { resetToken: '999999', newPassword: 'NewPassword123' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_code');
});

test('password reset flow: link mailed, reset works, old password dies, old sessions die', async () => {
  const { email, password, cookie: firstCookie } = await registerVerifiedUser('reset-flow@example.com');
  const forgot = await req('/api/auth/forgot-password', { method: 'POST', body: { email } });
  assert.equal(forgot.status, 200);
  const mail = mailTo(email, 'Reset your');
  assert.ok(mail, 'reset email captured');
  assert.match(mail.text, /\/reset-password\?token=\d{6}/);
  const code = resetCodeFromMail(mail);
  assert.match(code, /^\d{6}$/);

  const reset = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { resetToken: code, newPassword: 'BrandNewPass456' },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.ok, true);

  // The pre-reset session is revoked (logout-everywhere on password change).
  const stale = await req('/api/auth/me', { cookie: firstCookie });
  assert.equal(stale.status, 401);

  const oldLogin = await login(email, password);
  assert.equal(oldLogin.status, 401);
  const newLogin = await login(email, 'BrandNewPass456');
  assert.equal(newLogin.status, 200);

  // The reset code is single-use.
  const reuse = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { resetToken: code, newPassword: 'AnotherPass789' },
  });
  assert.equal(reuse.status, 400);
});

test('session cookie flags: Secure on https/production, not on plain local http', () => {
  const httpsOpts = cookieOptions({ protocol: 'https', headers: {} });
  assert.equal(httpsOpts.secure, true);
  assert.equal(httpsOpts.httpOnly, true);
  assert.equal(httpsOpts.sameSite, 'lax');
  const httpOpts = cookieOptions({ protocol: 'http', headers: {} });
  assert.equal(httpOpts.secure, false);
  assert.ok(base.startsWith('http://127.0.0.1'), 'tests run over local http');
});
