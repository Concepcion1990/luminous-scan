/**
 * Stripe client — T4 (twin plan §4.4 as overridden by the T4 task:
 * RAW Stripe API via fetch, NOT the stripe server SDK).
 *
 *   POST https://api.stripe.com/v1/... with
 *   Authorization: Bearer <STRIPE_SECRET_KEY> and
 *   application/x-www-form-urlencoded bodies.
 *
 * Rules (stripe-build-plan Phase 1, adapted to Express + Postgres):
 * - The secret key comes ONLY from the STRIPE_SECRET_KEY env var
 *   (a Fly secret in production). Never from the browser, never from
 *   a function argument, never logged — diagnostics log only the
 *   key prefix (sk_test_ / sk_live_) and the last 4 characters.
 * - Mode derives from the key prefix (sk_test_ → test, sk_live_ →
 *   live). A missing key or an unknown prefix refuses to run.
 * - LIVE GUARD: live-mode calls are refused unless the Fly secret
 *   STRIPE_LIVE_ENABLED is exactly 'true' (set only at Phase T9,
 *   after the live gate passes). While unset/false, any live-mode
 *   attempt returns stripe_live_not_enabled (503) — a test-phase
 *   mistake can never create a live charge.
 * - Idempotency: every POST that creates or changes a subscription
 *   or checkout carries an Idempotency-Key derived from the app's
 *   own ids (stockhaven:{business_id}:{purchase_id}:{action}).
 * - Errors: Stripe error objects map to the app's plain-language
 *   states; raw Stripe messages are never shown to customers.
 *
 * Test seam: __setStripeFetch replaces the transport (the T4 test
 * suite installs the mock Stripe there). Production always uses
 * global fetch. The seam is test-only and never changes behavior.
 */
import crypto from 'node:crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

let injectedFetch = null;

/** Test-only transport override (the mock Stripe). Never used in production. */
export function __setStripeFetch(fn) {
  injectedFetch = fn;
}

export function __clearStripeFetch() {
  injectedFetch = null;
}

export function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

/** 'test' | 'live' | null (missing key or unknown prefix). */
export function stripeMode(key = stripeSecretKey()) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  return null;
}

/** Live calls are allowed only when STRIPE_LIVE_ENABLED is exactly 'true'. */
export function stripeLiveEnabled() {
  return process.env.STRIPE_LIVE_ENABLED === 'true';
}

/** Diagnostics only: prefix + last 4 — never the key itself. */
export function keyFingerprint(key = stripeSecretKey()) {
  if (typeof key !== 'string' || key.length < 8) return 'not_configured';
  const mode = stripeMode(key);
  const prefix = mode === 'test' ? 'sk_test_' : mode === 'live' ? 'sk_live_' : key.slice(0, 8);
  return `${prefix}…${key.slice(-4)}`;
}

export function stripeConfigured() {
  return stripeMode() !== null;
}

export function idempotencyKey(businessId, purchaseId, action) {
  return `stockhaven:${businessId}:${purchaseId}:${action}`;
}

export class StripeError extends Error {
  constructor({ status = 502, code = 'stripe_error', message = 'Stripe could not be reached.', stripeCode = null, param = null } = {}) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.code = code;
    this.stripeCode = stripeCode;
    this.param = param;
  }
}

function stripeErrorFromResponse(status, body) {
  const stripeError = body?.error || {};
  const message = typeof stripeError.message === 'string' && stripeError.message
    ? stripeError.message
    : 'Stripe could not be reached.';
  // Map to plain-language app states; the raw Stripe message is kept
  // server-side only (in the Error object), never sent to the browser.
  let code = 'stripe_error';
  if (status === 401) code = 'stripe_auth_failed';
  else if (status === 402) code = 'stripe_card_error';
  else if (status === 404) code = 'stripe_not_found';
  else if (status === 429) code = 'stripe_rate_limited';
  else if (status >= 500) code = 'stripe_unavailable';
  return new StripeError({ status: status >= 400 && status < 600 ? status : 502, code, message, stripeCode: stripeError.code || null, param: stripeError.param || null });
}

/** Flatten a nested params object to Stripe's form-encoded shape:
 *  { line_items: [{ price: 'x' }] } → 'line_items[0][price]=x'. */
export function toFormBody(params) {
  const body = new URLSearchParams();
  const append = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) append(`${prefix}[${key}]`, item);
      return;
    }
    body.append(prefix, String(value));
  };
  for (const [key, value] of Object.entries(params || {})) append(key, value);
  return body;
}

/**
 * One raw Stripe call. Throws StripeError (with .status / .code) on
 * any failure. Refuses to run without a key, with an unknown key
 * prefix, or in live mode while the live guard is off.
 */
export async function stripeRequest(path, { method = 'GET', params = {}, idempotencyKey: key = null } = {}) {
  const secret = stripeSecretKey();
  if (!secret) {
    throw Object.assign(new Error('Stripe is not configured.'), { status: 503, code: 'stripe_not_configured' });
  }
  const mode = stripeMode(secret);
  if (!mode) {
    throw Object.assign(new Error('Stripe is not configured.'), { status: 503, code: 'stripe_not_configured' });
  }
  if (mode === 'live' && !stripeLiveEnabled()) {
    throw Object.assign(new Error('Live Stripe calls are not enabled yet.'), { status: 503, code: 'stripe_live_not_enabled' });
  }
  const fetchFn = injectedFetch || globalThis.fetch;
  const url = method === 'GET' && params && Object.keys(params).length
    ? `${STRIPE_API_BASE}${path}?${toFormBody(params).toString()}`
    : `${STRIPE_API_BASE}${path}`;
  const headers = { Authorization: `Bearer ${secret}` };
  if (key) headers['Idempotency-Key'] = key;
  let response;
  try {
    response = await fetchFn(url, {
      method,
      headers: method === 'GET'
        ? headers
        : { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : toFormBody(params),
    });
  } catch (error) {
    throw new StripeError({ status: 502, code: 'stripe_unavailable', message: `Stripe could not be reached: ${error.message}` });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = stripeErrorFromResponse(response.status, body);
    // Log the failure server-side with the key fingerprint only — never the key.
    console.error(`[twin] Stripe ${method} ${path} failed (${keyFingerprint(secret)}):`, error.message);
    throw error;
  }
  return body;
}

export async function stripeGet(path, params = {}) {
  return stripeRequest(path, { method: 'GET', params });
}

export async function stripePost(path, params = {}, options = {}) {
  return stripeRequest(path, { method: 'POST', params, ...options });
}

/** Verify a Stripe webhook signature (HMAC-SHA256 over t={ts}.{raw}).
 *  Returns { ok, reason }. Rejects stale timestamps (> 5 minutes)
 *  and bad signatures — never returns ok for an unverified event. */
export function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  if (typeof signatureHeader !== 'string' || !signatureHeader) return { ok: false, reason: 'missing_signature' };
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((pair) => {
      const [key, ...rest] = pair.split('=');
      return [key, rest.join('=')];
    }),
  );
  const timestamp = Number.parseInt(parts.t || '', 10);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'missing_timestamp' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > 5 * 60) return { ok: false, reason: 'stale_timestamp' };
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const signatures = String(parts.v1 || '').split(' ').filter(Boolean);
  if (!signatures.length) return { ok: false, reason: 'missing_signature' };
  for (const candidate of signatures) {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, reason: null };
  }
  return { ok: false, reason: 'bad_signature' };
}

// ---------------------------------------------------------------------------
// Call shapes used by the billing routes (stripe-build-plan API table).
// Each is a thin wrapper over stripeRequest so the mock Stripe in the
// T4 tests only has to implement the same HTTP shapes.
// ---------------------------------------------------------------------------

export const stripeApi = {
  createCheckoutSession: (params, options) =>
    stripePost('/checkout/sessions', params, options),

  getCheckoutSession: (sessionId) =>
    stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { 'expand[]': 'subscription' }),

  getSubscription: (subscriptionId) =>
    stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`),

  updateSubscription: (subscriptionId, params, options) =>
    stripePost(`/subscriptions/${encodeURIComponent(subscriptionId)}`, params, options),

  listCustomersByEmail: async (email) => {
    const page = await stripeGet('/customers', { email, limit: 10 });
    return page?.data ?? [];
  },

  listSubscriptionsByCustomer: async (customerId) => {
    const page = await stripeGet('/subscriptions', { customer: customerId, limit: 100 });
    return page?.data ?? [];
  },

  listInvoicesBySubscription: async (subscriptionId) => {
    const page = await stripeGet('/invoices', { subscription: subscriptionId, limit: 100 });
    return page?.data ?? [];
  },

  getInvoice: (invoiceId) =>
    stripeGet(`/invoices/${encodeURIComponent(invoiceId)}`),

  createRefund: (params, options) =>
    stripePost('/refunds', params, options),
};
