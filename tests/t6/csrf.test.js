/**
 * T6.1 — CSRF protection, flush-time token design (T6 carry-forward).
 *
 *   (a) a mutating request without a valid token is rejected (403
 *       csrf_invalid) — including a token from another session and a
 *       forged token;
 *   (b) a request with a fresh token succeeds;
 *   (c) an offline-queued change still applies after reconnect: the
 *       queued change never carries a token — the token is fetched
 *       fresh at flush time, so rotation cannot strand queued work.
 *       The existing offline acceptance tests (offlineSync.test.js)
 *       must stay green alongside these.
 *
 * Server enforcement is global (app.js mounts it ahead of every
 * router), so the tests prove it on several surfaces at once: the
 * sync endpoint, a generic entity write, and the business create.
 * Signed-out requests still answer 401 (never a 403 that would mask
 * "signed out"), and the pre-auth endpoints still work token-free.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  receive,
  onHand,
  queuedMovement,
} from './helpers.js';
import { issueCsrfToken, verifyCsrfToken, isCsrfExempt, CSRF_WINDOW_MS } from '../../server/csrf.js';
import { createMemoryQueue, newQueuedChange } from '../../src/lib/offlineQueue.js';
import { flushQueue, defaultSend } from '../../src/lib/syncClient.js';

after(close);

async function fetchToken(cookie) {
  const res = await req('/api/csrf-token', { cookie });
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.csrf_token, 'string');
  return res.json.csrf_token;
}

test('the token endpoint needs a session, and issues a token bound to it', async () => {
  const signedOut = await req('/api/csrf-token');
  assert.equal(signedOut.status, 401);

  const owner = await ownerWithBusiness('csrf-token@example.com');
  const token = await fetchToken(owner.cookie);
  assert.match(token, /^\d+\.[0-9a-f]{64}$/);
});

test('a mutating request without a token is rejected, on every surface', async () => {
  const owner = await ownerWithBusiness('csrf-none@example.com');
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Aisle 1' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'CSRF Book', sku: 'CSRF-001', price: 10 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 5);

  // Sync-apply without a token.
  const sync = await req(`/api/businesses/${owner.business.id}/sync/apply`, {
    method: 'POST',
    body: { changes: [queuedMovement(product.id, location.id, 'sale', 1)] },
    cookie: owner.cookie,
    csrf: false,
  });
  assert.equal(sync.status, 403);
  assert.equal(sync.json.error, 'csrf_invalid');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 5);

  // A generic entity write without a token.
  const entity = await req('/api/entities/Category', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'No Token Category' },
    cookie: owner.cookie,
    csrf: false,
  });
  assert.equal(entity.status, 403);
  assert.equal(entity.json.error, 'csrf_invalid');

  // A business create without a token (auth router, not just shop).
  const business = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'No Token Shop' },
    cookie: owner.cookie,
    csrf: false,
  });
  assert.equal(business.status, 403);
  assert.equal(business.json.error, 'csrf_invalid');
});

test('a forged token and a token from another session are both rejected', async () => {
  const owner = await ownerWithBusiness('csrf-forged@example.com');
  const other = await ownerWithBusiness('csrf-other@example.com');
  const othersToken = await fetchToken(other.cookie);

  const forged = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'Forged Shop' },
    cookie: owner.cookie,
    headers: { 'X-CSRF-Token': '123456.0000000000000000000000000000000000000000000000000000000000000000' },
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.json.error, 'csrf_invalid');

  const borrowed = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'Borrowed Shop' },
    cookie: owner.cookie,
    headers: { 'X-CSRF-Token': othersToken },
  });
  assert.equal(borrowed.status, 403);
  assert.equal(borrowed.json.error, 'csrf_invalid');
});

test('a request with a fresh token succeeds', async () => {
  const owner = await ownerWithBusiness('csrf-fresh@example.com');
  // A second business needs the Business plan (Essentials caps at
  // one) — the cap is the route's own rule, not CSRF, so lift it
  // first and prove the token is what lets the call through.
  await setPlan(owner.business.id, 'business', owner.user.id);
  const token = await fetchToken(owner.cookie);
  const res = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'Fresh Token Shop' },
    cookie: owner.cookie,
    headers: { 'X-CSRF-Token': token },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.name, 'Fresh Token Shop');
});

test('signed-out mutating requests still answer 401, not 403', async () => {
  const res = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'Nobody Shop' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'not_signed_in');
});

test('the pre-auth endpoints still work with no token at all', async () => {
  // Register + login are the exempt paths: no session exists yet, so
  // there is nothing to bind a token to. A full register/login cycle
  // through the plain helper proves the exemption is real.
  const user = await ownerWithBusiness('csrf-preauth@example.com');
  assert.equal(typeof user.cookie, 'string');
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: user.email, password: user.password },
    csrf: false,
  });
  assert.equal(login.status, 200);
});

test('tokens rotate by window: current and previous windows verify, older ones do not', () => {
  const sessionId = 'session-for-window-test';
  const now = Date.now();
  const current = issueCsrfToken(sessionId, now);
  assert.equal(verifyCsrfToken(sessionId, current, now), true);
  // A token issued in the previous window still verifies now.
  const previous = issueCsrfToken(sessionId, now - CSRF_WINDOW_MS);
  assert.equal(verifyCsrfToken(sessionId, previous, now), true);
  // Two windows back is dead.
  const stale = issueCsrfToken(sessionId, now - 2 * CSRF_WINDOW_MS);
  assert.equal(verifyCsrfToken(sessionId, stale, now), false);
  // A token from the future is dead too.
  const future = issueCsrfToken(sessionId, now + 2 * CSRF_WINDOW_MS);
  assert.equal(verifyCsrfToken(sessionId, future, now), false);
  // Same token, different session: dead.
  assert.equal(verifyCsrfToken('another-session', current, now), false);
});

test('only the pre-auth endpoints and the job endpoint are exempt', () => {
  for (const path of [
    '/api/auth/register',
    '/api/auth/verify',
    '/api/auth/resend-otp',
    '/api/auth/login',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/billing/wipe-sweep',
  ]) {
    assert.equal(isCsrfExempt(path), true, path);
  }
  for (const path of [
    '/api/auth/logout',
    '/api/auth/me',
    '/api/businesses',
    '/api/billing/checkout',
    '/api/businesses/x/sync/apply',
    '/api/entities/Product',
    '/api/csrf-token',
  ]) {
    assert.equal(isCsrfExempt(path), false, path);
  }
});

test('offline flush: a queued change carries no token and applies with a token fetched at send time', async () => {
  const owner = await ownerWithBusiness('csrf-flush@example.com');
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Aisle 1' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Flush Book', sku: 'FLUSH-001', price: 10 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 10);

  // The phone is offline: the scan is queued on the device. The
  // queued change holds only its identity and its work — no token,
  // nothing that can go stale while the phone is offline.
  const queue = createMemoryQueue();
  const change = newQueuedChange(owner.business.id, 'movement', {
    product_id: product.id,
    location_id: location.id,
    type: 'sale',
    quantity: 3,
  });
  await queue.add(change);
  const stored = (await queue.all())[0];
  assert.equal('csrf_token' in stored, false);
  assert.equal('token' in stored, false);
  assert.deepEqual(Object.keys(stored.payload).sort(), ['location_id', 'product_id', 'quantity', 'type']);

  // Reconnect: the flush fetches a FRESH token at send time (the
  // token did not exist when the change was queued) and applies it.
  const freshToken = await fetchToken(owner.cookie);
  const res = await req(`/api/businesses/${owner.business.id}/sync/apply`, {
    method: 'POST',
    body: {
      changes: [{
        idempotency_key: stored.key,
        kind: stored.kind,
        payload: stored.payload,
      }],
    },
    cookie: owner.cookie,
    headers: { 'X-CSRF-Token': freshToken },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 7);
});

test('defaultSend fetches a fresh token at send time and sends it as a header (client)', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).endsWith('/api/csrf-token')) {
      return { ok: true, json: async () => ({ csrf_token: 'fresh-token-123' }) };
    }
    return { ok: true, json: async () => ({ results: [{ status: 'applied' }] }) };
  };
  try {
    // A mutating send fetches the token first, then sends with it.
    const result = await defaultSend('/api/businesses/biz-1/sync/apply', {
      method: 'POST',
      body: { changes: [{ idempotency_key: 'k1', kind: 'movement', payload: {} }] },
    });
    assert.equal(result.results[0].status, 'applied');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/api/csrf-token');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].url, '/api/businesses/biz-1/sync/apply');
    assert.equal(calls[1].headers['X-CSRF-Token'], 'fresh-token-123');

    // A GET never fetches a token.
    calls.length = 0;
    await defaultSend('/api/businesses/biz-1/sync/state');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/businesses/biz-1/sync/state');

    // flushQueue sends only idempotency_key/kind/payload — never a token.
    const queue = createMemoryQueue();
    await queue.add(newQueuedChange('biz-1', 'movement', { product_id: 'p1', type: 'sale', quantity: 1 }));
    const seen = [];
    const send = async (_path, { body }) => {
      seen.push(body);
      return { results: body.changes.map(() => ({ status: 'applied' })) };
    };
    const summary = await flushQueue(queue, 'biz-1', { send });
    assert.equal(summary.confirmed, 1);
    assert.deepEqual(Object.keys(seen[0].changes[0]).sort(), ['idempotency_key', 'kind', 'payload']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the cross-store Business-only rule still holds with CSRF enforced', async () => {
  const owner = await ownerWithBusiness('csrf-cross@example.com');
  await setPlan(owner.business.id, 'essentials', owner.user.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Essentials Cross Book', sku: 'CSRF-ESS-001', price: 10 },
  ]);
  // No token: CSRF fires first (403 csrf_invalid). With a token: the
  // plan rule fires (403 cross_store_business_only). Both refusals
  // are real — the plan rule was not silently replaced by CSRF.
  const noToken = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: owner.business.id, product_id: product.id, mode: 'ship' },
    cookie: owner.cookie,
    csrf: false,
  });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.json.error, 'csrf_invalid');
  const withToken = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: owner.business.id, product_id: product.id, mode: 'ship' },
    cookie: owner.cookie,
  });
  assert.equal(withToken.status, 403);
  assert.equal(withToken.json.error, 'cross_store_business_only');
});
