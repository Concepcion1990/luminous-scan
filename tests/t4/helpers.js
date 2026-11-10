/**
 * T4 test helpers — boots the REAL Express app against an in-memory
 * pg-mem Postgres (same SQL, same routes as production) with the
 * MOCK Stripe installed as the transport (no test key, no live key,
 * no real charge — the test secret key has NOT landed yet).
 *
 * Stripe env is set BEFORE the server modules are imported (the
 * client reads env at call time; the catalog reads test Price IDs
 * from env). Attestations are set 'true' so the readiness gate
 * passes in tests — they are test-run attestations for the mock,
 * not production attestations.
 */
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = `test-session-secret-${crypto.randomBytes(16).toString('hex')}`;
process.env.EMAIL_FROM = 'test@theluminousbookshop.test';
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_API_KEY;
delete process.env.DATABASE_URL;
// Mock-Stripe test config (NOT real keys — the mock transport answers).
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_t4_0000';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock_t4_secret';
process.env.STRIPE_TEST_PRICE_ESSENTIALS = 'price_test_essentials_t4';
process.env.STRIPE_TEST_PRICE_BUSINESS = 'price_test_business_t4';
process.env.STRIPE_FULFILLMENT_TESTS_PASSED = 'true';
process.env.STRIPE_TEST_CONTAINMENT_VERIFIED = 'true';
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
process.env.BILLING_JOB_SECRET = 'test-job-secret-t4';
delete process.env.STRIPE_LIVE_ENABLED;

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
export const JOB_SECRET = process.env.BILLING_JOB_SECRET;

const { newDb } = await import('pg-mem');
const { setPoolOverride } = await import('../../server/db.js');
const { runMigrations } = await import('../../server/migrate.js');
const { createApp } = await import('../../server/app.js');
const { __setMailSink } = await import('../../server/email.js');
const { __resetAuthRateLimits } = await import('../../server/authRoutes.js');
const { __setStripeFetch } = await import('../../server/stripeClient.js');
const { createMockStripe } = await import('./mockStripe.js');

export const mock = createMockStripe();
__setStripeFetch(mock.fetch);

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
export async function req(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const allHeaders = { 'Content-Type': 'application/json', ...headers };
  if (cookie) allHeaders.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: allHeaders,
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

/** Raw-body fetch (webhook posts): body is a string, headers pass through. */
export async function reqRaw(path, { method = 'POST', body = '', headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

export function cookieFrom(setCookieHeader) {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(';')[0].trim();
}

export function codeFromMail(message) {
  const m = String(message?.text || '').match(/code is (\d{6})/);
  return m ? m[1] : null;
}

export function mailTo(email, subjectPart) {
  return mailbox.find((m) => m.to === email && (!subjectPart || m.subject.includes(subjectPart)));
}

export async function registerVerifiedUser(email, password = 'CorrectHorse123') {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  if (reg.status !== 201) throw new Error(`register failed for ${email}: ${reg.status} ${reg.text}`);
  const code = codeFromMail(mailTo(email, 'verification code'));
  if (!code) throw new Error(`no verification code mailed to ${email}`);
  const verify = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  if (verify.status !== 200) throw new Error(`verify failed for ${email}: ${verify.status} ${verify.text}`);
  return { email, password, cookie: cookieFrom(verify.setCookie), user: verify.json.user };
}

export function resetRateLimits() {
  __resetAuthRateLimits();
}

export async function createBusiness(cookie, name = 'Test Shop') {
  const res = await req('/api/businesses', { method: 'POST', body: { name }, cookie });
  if (res.status !== 201) throw new Error(`create business failed: ${res.status} ${res.text}`);
  return res.json;
}

export async function ownerWithBusiness(email, name = 'Test Shop') {
  const owner = await registerVerifiedUser(email);
  const business = await createBusiness(owner.cookie, name);
  return { ...owner, business };
}

/** Full trial checkout + reconcile for one owner/business (mock Stripe). */
export async function trialCheckout(owner, businessId, plan = 'essentials') {
  const checkout = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan, business_id: businessId },
    cookie: owner.cookie,
  });
  if (checkout.status !== 200) throw new Error(`checkout failed: ${checkout.status} ${checkout.text}`);
  const reconcile = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: checkout.json.session_id, business_id: businessId },
    cookie: owner.cookie,
  });
  if (reconcile.status !== 200) throw new Error(`reconcile failed: ${reconcile.status} ${reconcile.text}`);
  return { checkout: checkout.json, reconcile: reconcile.json };
}

/** Set a business's entitlement row directly (test-only shortcut for
 *  grace/wipe fixtures — the grant route is the normal writer). */
export async function setEntitlement(businessId, { plan = 'essentials', status = 'active', trialEndsAt = null, periodEndsAt = null } = {}) {
  await pool.query('DELETE FROM entitlements WHERE business_id = $1', [businessId]);
  await pool.query(
    `INSERT INTO entitlements (id, business_id, plan, status, trial_ends_at, period_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), businessId, plan, status, trialEndsAt, periodEndsAt],
  );
}
