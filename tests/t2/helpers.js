/**
 * T2 test helpers — boots the REAL Express app against an in-memory
 * pg-mem Postgres (same SQL, same routes as production) with an
 * in-memory mail sink (no real email is ever sent).
 *
 * Env is set BEFORE the server modules are imported (config reads env
 * at import time). Each test file runs in its own process, so each
 * file gets a fresh database, fresh rate limits, and a fresh sink.
 */
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = `test-session-secret-${crypto.randomBytes(16).toString('hex')}`;
process.env.EMAIL_FROM = 'test@theluminousbookshop.test';
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_API_KEY;
delete process.env.DATABASE_URL;

const { newDb } = await import('pg-mem');
const { setPoolOverride } = await import('../../server/db.js');
const { runMigrations } = await import('../../server/migrate.js');
const { createApp } = await import('../../server/app.js');
const { __setMailSink } = await import('../../server/email.js');
const { __resetAuthRateLimits } = await import('../../server/authRoutes.js');

export const mailbox = [];
__setMailSink(async (message) => {
  mailbox.push(message);
});

const db = newDb();
const { Pool } = db.adapters.createPg();
const pool = new Pool();
setPoolOverride(pool);
await runMigrations();

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
export const base = `http://127.0.0.1:${server.address().port}`;

export { pool };

export async function close() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

/** Minimal fetch wrapper with a cookie jar slot. Returns { status, json, text, setCookie }. */
export async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}

/** 'twin_session=...' value from a Set-Cookie header (first cookie only). */
export function cookieFrom(setCookieHeader) {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(';')[0].trim();
}

export function codeFromMail(message) {
  const m = String(message?.text || '').match(/code is (\d{6})/);
  return m ? m[1] : null;
}

export function resetCodeFromMail(message) {
  const m = String(message?.text || '').match(/token=(\d{6})/);
  return m ? m[1] : null;
}

export function mailTo(email, subjectPart) {
  return mailbox.find((m) => m.to === email && (!subjectPart || m.subject.includes(subjectPart)));
}

/** Register + verify a user; returns { email, password, cookie, user }. */
export async function registerVerifiedUser(email, password = 'CorrectHorse123') {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  if (reg.status !== 201) throw new Error(`register failed for ${email}: ${reg.status} ${reg.text}`);
  const code = codeFromMail(mailTo(email, 'verification code'));
  if (!code) throw new Error(`no verification code mailed to ${email}`);
  const verify = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  if (verify.status !== 200) throw new Error(`verify failed for ${email}: ${verify.status} ${verify.text}`);
  return { email, password, cookie: cookieFrom(verify.setCookie), user: verify.json.user };
}

export async function login(email, password) {
  return req('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function resetRateLimits() {
  __resetAuthRateLimits();
}
