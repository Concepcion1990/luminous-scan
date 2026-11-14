/**
 * T27 — POS provider expansion (Nov 14, 2026).
 *
 * The six remaining providers join Square + Shopify over the
 * SAME shared core (server/posCore.js): clover, toast,
 * lightspeed, zettle (PayPal Zettle), stripe_terminal, wix.
 * Each adapter is built to its provider's DOCUMENTED public API
 * shape; these tests prove, per provider:
 *   - the connect route stores credentials server-side only and
 *     no response ever serializes them;
 *   - the Business-only plan gate refuses Essentials on the new
 *     connect routes (reads included, via the shared ctx);
 *   - the webhook verifies the provider's documented signature
 *     scheme and refuses anything unverified (never 200);
 *   - a delivered sale normalizes into the shared pipeline —
 *     ledger movements, per-sale idempotency, never twice;
 *   - the provider-specific honesty rules: Clover events carry
 *     only order ids (the adapter fetches the order), Toast
 *     webhooks likewise; a Lightspeed sale counts only when
 *     CLOSED; a Stripe Terminal charge without item metadata is
 *     acknowledged and NOT recorded; a Wix order counts only
 *     when PAID; a Toast sale arriving off-Business is held for
 *     the plan and applies on return.
 *
 * Provider API calls (Clover/Toast order fetches) are stubbed at
 * the global fetch seam, keyed by URL host — the same seam the
 * adapters use in production (global fetch) — while every call
 * to the app itself goes over real HTTP, like every other phase.
 *
 * Real Express app over HTTP against pg-mem, same as T18.
 * Webhook signatures are computed over the exact bytes sent.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  base,
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createLocation,
  createProducts,
  receive,
  onHand,
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const POS = (bid) => `/api/businesses/${bid}/pos`;

// ---- Provider API fetch stubs (Clover / Toast order fetches) ----------------

const realFetch = globalThis.fetch;
const cloverOrders = new Map();
const toastOrders = new Map();
let lastCloverAuth = '';
let lastToastRestaurantHeader = '';

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://api.clover.com/')) {
    lastCloverAuth = options.headers?.Authorization || '';
    const match = /\/v3\/merchants\/[^/]+\/orders\/([^/?]+)/.exec(href);
    const order = match ? cloverOrders.get(match[1]) : null;
    return order ? jsonResponse(order) : jsonResponse({ message: 'not found' }, 404);
  }
  if (href.startsWith('https://ws-api.toasttab.com/')) {
    if (href.includes('/authentication/v1/authentication/login')) {
      return jsonResponse({ token: { accessToken: 'toast-access-token', expiresIn: 3600 } });
    }
    lastToastRestaurantHeader = options.headers?.['Toast-Restaurant-External-ID'] || '';
    const match = /\/orders\/v2\/orders\/([^/?]+)/.exec(href);
    const order = match ? toastOrders.get(match[1]) : null;
    return order ? jsonResponse(order) : jsonResponse({ message: 'not found' }, 404);
  }
  return realFetch(url, options);
};

// ---- Webhook env — adapters read env at call time (like Fly secrets) --------

const CLOVER_AUTH = 'clover-auth-code-TEST';
const TOAST_SECRET = 'toast-signing-TESTSECRET';
delete process.env.CLOVER_APP_ID;
delete process.env.CLOVER_APP_SECRET;
delete process.env.CLOVER_WEBHOOK_AUTH_CODE; // set later — the 503 test runs first
process.env.TOAST_WEBHOOK_SECRET = TOAST_SECRET;
delete process.env.LIGHTSPEED_CLIENT_SECRET; // per-connection secrets carry the tests
delete process.env.WIX_PUBLIC_KEY; // set later — the 503 test runs first

// ---- Raw webhook posting (signatures cover the exact bytes) -----------------

async function rawPost(path, bodyText, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyText,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

// ---- Fixtures -----------------------------------------------------------------

async function shopSetup(email, name = 'Till Shop') {
  const setup = await ownerWithBusiness(email, name);
  await setPlan(setup.business.id, 'business', setup.user.id);
  const location = await createLocation(setup.cookie, setup.business.id, { name: 'Main store' });
  const [mug, journal] = await createProducts(setup.cookie, setup.business.id, [
    { name: 'Enamel Mug', sku: 'SKU-MUG', upc: '012345678905', price: 12 },
    { name: 'Linen Journal', sku: 'SKU-JRN', upc: '012345678912', price: 18 },
  ]);
  await receive(setup.cookie, setup.business.id, mug.id, location.id, 10);
  await receive(setup.cookie, setup.business.id, journal.id, location.id, 3);
  return { ...setup, location, mug, journal };
}

async function eventRow(businessId, provider, externalSaleId) {
  const { rows } = await pool.query(
    'SELECT * FROM pos_sale_events WHERE business_id = $1 AND provider = $2 AND external_sale_id = $3',
    [businessId, provider, externalSaleId],
  );
  return rows[0] ?? null;
}

// ============================================================================
// CLOVER
// ============================================================================

test('Clover webhook fails closed (503) before its auth code is configured', async () => {
  const res = await rawPost('/webhooks/pos/clover', JSON.stringify({ merchants: {} }), {
    'x-clover-auth': 'anything',
  });
  assert.equal(res.status, 503);
  process.env.CLOVER_WEBHOOK_AUTH_CODE = CLOVER_AUTH; // configured from here on
});

test('Clover connect answers plainly when the platform OAuth app is not configured', async () => {
  const { cookie, business } = await shopSetup('pos2-clover-connect@example.com');
  const res = await req(`${POS(business.id)}/clover/connect`, { method: 'POST', cookie, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.json.configured, false);
  assert.match(res.json.message, /not switched on yet/);
});

test('Clover: verification ping answered, bad auth refused, order event fetches + applies, replay is a no-op', async () => {
  const { cookie, business, location, mug, journal } = await shopSetup('pos2-clover@example.com');
  // A connected Clover connection, inserted directly (OAuth itself needs real Clover keys).
  await pool.query(
    `INSERT INTO pos_connections (id, business_id, provider, status, label, provider_account_id, credentials)
     VALUES ($1, $2, 'clover', 'connected', 'Clover till', 'CLOV-MERCH-1', $3)`,
    [crypto.randomUUID(), business.id, JSON.stringify({ access_token: 'clover-token-TESTSECRET' })],
  );
  cloverOrders.set('CLV-ORDER-1', {
    id: 'CLV-ORDER-1',
    total: 4200,
    currency: 'USD',
    createdTime: 1763000000000,
    lineItems: {
      elements: [
        { id: 'li1', name: 'Enamel Mug', quantity: 2, item: { id: 'ITEM-MUG', sku: 'SKU-MUG' } },
        { id: 'li2', name: 'Linen Journal', quantity: 1, item: { id: 'ITEM-JRN', sku: 'SKU-JRN' } },
        { id: 'li3', name: 'Refunded Mug', quantity: 1, refunded: true, item: { id: 'ITEM-MUG', sku: 'SKU-MUG' } },
      ],
    },
  });

  // The dashboard's endpoint-verification ping: header checked, nothing recorded.
  const ping = await rawPost('/webhooks/pos/clover', JSON.stringify({ verificationCode: '123456' }), {
    'x-clover-auth': CLOVER_AUTH,
  });
  assert.equal(ping.status, 200);
  assert.equal(ping.json.recorded, false);

  // A wrong auth code is refused, never 200.
  const bad = await rawPost('/webhooks/pos/clover', JSON.stringify({ merchants: { 'CLOV-MERCH-1': [] } }), {
    'x-clover-auth': 'wrong-code',
  });
  assert.equal(bad.status, 400);

  const payload = { appId: 'APP1', merchants: { 'CLOV-MERCH-1': [{ objectId: 'O:CLV-ORDER-1', type: 'CREATE', ts: 1763000000000 }] } };
  const res = await rawPost('/webhooks/pos/clover', JSON.stringify(payload), { 'x-clover-auth': CLOVER_AUTH });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(lastCloverAuth, 'Bearer clover-token-TESTSECRET', 'the order fetch used the stored merchant token');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);
  const event = await eventRow(business.id, 'clover', 'CLV-ORDER-1');
  assert.equal(event.status, 'applied');
  assert.equal(Number(event.total_amount), 42);

  // Replay: idempotent, stock untouched.
  const replay = await rawPost('/webhooks/pos/clover', JSON.stringify(payload), { 'x-clover-auth': CLOVER_AUTH });
  assert.equal(replay.json.results[0].duplicate, true);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  // Unknown merchant: no connection matches.
  const orphan = await rawPost(
    '/webhooks/pos/clover',
    JSON.stringify({ merchants: { 'CLOV-UNKNOWN': [{ objectId: 'O:X', type: 'CREATE', ts: 1 }] } }),
    { 'x-clover-auth': CLOVER_AUTH },
  );
  assert.equal(orphan.status, 404);
  void cookie;
});

// ============================================================================
// TOAST
// ============================================================================

const TOAST_ORDER = {
  guid: 'TOAST-ORDER-1',
  createdDate: '2026-11-14T15:00:00.000+0000',
  checks: [{
    guid: 'CHK-1',
    totalAmount: 42.0,
    selections: [
      { guid: 'SEL-1', displayName: 'Enamel Mug', quantity: 2, plu: 'SKU-MUG', item: { guid: 'ITEM-MUG' } },
      { guid: 'SEL-2', displayName: 'Linen Journal', quantity: 1, plu: 'SKU-JRN', item: { guid: 'ITEM-JRN' } },
    ],
  }],
};

function toastSignature(bodyText, timestamp) {
  return crypto.createHmac('sha256', TOAST_SECRET).update(`${bodyText}${timestamp}`, 'utf8').digest('base64');
}

async function postToastOrder(restaurantGuid = 'REST-3', orderGuid = 'TOAST-ORDER-1') {
  const payload = {
    eventCategory: 'order_updated',
    restaurantGuid,
    orderGuid,
    timestamp: '2026-11-14T15:00:01.000Z',
  };
  const body = JSON.stringify(payload);
  return rawPost('/webhooks/pos/toast', body, { 'toast-signature': toastSignature(body, payload.timestamp) });
}

test('Toast connect: Business stores credentials server-side only; Essentials is plan_gated', async () => {
  const { cookie, business } = await shopSetup('pos2-toast-connect@example.com');
  const res = await req(`${POS(business.id)}/toast/connect`, {
    method: 'POST',
    cookie,
    body: { client_id: 'toast-client-1', client_secret: 'toast-secret-TESTSECRET', restaurant_guid: 'REST-1' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.connection.status, 'connected');
  assert.equal(res.json.connection.has_credentials, true);
  assert.ok(!res.text.includes('toast-secret-TESTSECRET'), 'connect response hides the secret');

  const overview = await req(`${POS(business.id)}/overview`, { cookie });
  assert.equal(overview.status, 200);
  assert.ok(!overview.text.includes('toast-secret-TESTSECRET'), 'overview hides the secret');
  const card = overview.json.connections.find((c) => c.provider === 'toast');
  assert.equal(card.status, 'connected');
  assert.equal(overview.json.providers.toast.webhook_configured, true);

  // Essentials: the shared gate refuses the new connect route too.
  const ess = await ownerWithBusiness('pos2-toast-ess@example.com', 'Essentials Shop');
  await setPlan(ess.business.id, 'essentials', ess.user.id);
  const refused = await req(`${POS(ess.business.id)}/toast/connect`, {
    method: 'POST',
    cookie: ess.cookie,
    body: { client_id: 'x', client_secret: 'toast-secret-TESTSECRET', restaurant_guid: 'REST-9' },
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'plan_gated');
  const refusedRead = await req(`${POS(ess.business.id)}/overview`, { cookie: ess.cookie });
  assert.equal(refusedRead.status, 403);
  assert.equal(refusedRead.json.error, 'plan_gated');
});

test('Toast webhook: bad signature refused; a signed order event fetches the order and applies; replay no-op', async () => {
  const { cookie, business, location, mug, journal } = await shopSetup('pos2-toast@example.com');
  await req(`${POS(business.id)}/toast/connect`, {
    method: 'POST',
    cookie,
    body: { client_id: 'toast-client-1', client_secret: 'toast-secret-TESTSECRET', restaurant_guid: 'REST-3' },
  });
  toastOrders.set('TOAST-ORDER-1', TOAST_ORDER);

  const payload = { eventCategory: 'order_updated', restaurantGuid: 'REST-3', orderGuid: 'TOAST-ORDER-1', timestamp: '2026-11-14T15:00:01.000Z' };
  const body = JSON.stringify(payload);
  const bad = await rawPost('/webhooks/pos/toast', body, { 'toast-signature': 'bogus' });
  assert.equal(bad.status, 400);

  const res = await postToastOrder();
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.status, 'applied');
  assert.equal(lastToastRestaurantHeader, 'REST-3');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);

  const replay = await postToastOrder();
  assert.equal(replay.json.duplicate, true);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
});

test('Toast sale arriving while off Business is held for the plan and applies on return', async () => {
  const { cookie, business, location, mug } = await shopSetup('pos2-toast-held@example.com');
  await req(`${POS(business.id)}/toast/connect`, {
    method: 'POST',
    cookie,
    body: { client_id: 'toast-client-2', client_secret: 'toast-secret-TESTSECRET', restaurant_guid: 'REST-2' },
  });
  toastOrders.set('TOAST-ORDER-2', { ...TOAST_ORDER, guid: 'TOAST-ORDER-2' });

  await setPlan(business.id, 'essentials', null);
  const held = await postToastOrder('REST-2', 'TOAST-ORDER-2');
  assert.equal(held.status, 200, held.text);
  assert.equal(held.json.status, 'held_plan');
  assert.equal(await onHand(business.id, mug.id, location.id), 10, 'nothing applied while off Business');
  const event = await eventRow(business.id, 'toast', 'TOAST-ORDER-2');
  assert.equal(event.status, 'held_plan');

  await setPlan(business.id, 'business', null);
  const applied = await req(`${POS(business.id)}/apply-held-plan`, { method: 'POST', cookie, body: {} });
  assert.equal(applied.status, 200, applied.text);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
});

// ============================================================================
// LIGHTSPEED
// ============================================================================

const LS_SECRET = 'ls-webhook-TESTSECRET';

function lightspeedSignature(bodyText, secret = LS_SECRET) {
  const hex = crypto.createHmac('sha256', secret).update(bodyText, 'utf8').digest('hex');
  return `signature=${hex},algorithm=HMAC-SHA256`;
}

async function postLightspeedSale(sale, storeKey = 'tillshop', secret = LS_SECRET) {
  const body = JSON.stringify(sale);
  return rawPost(`/webhooks/pos/lightspeed/${storeKey}`, body, { 'x-signature': lightspeedSignature(body, secret) });
}

test('Lightspeed: connect exposes the webhook path; only CLOSED sales record; unmatched item maps and applies', async () => {
  const { cookie, business, location, mug } = await shopSetup('pos2-lightspeed@example.com');
  const connect = await req(`${POS(business.id)}/lightspeed/connect`, {
    method: 'POST',
    cookie,
    body: { domain_prefix: 'tillshop', api_token: 'ls-token-TESTSECRET', webhook_secret: LS_SECRET },
  });
  assert.equal(connect.status, 201, connect.text);
  assert.equal(connect.json.connection.webhook_path, '/webhooks/pos/lightspeed/tillshop');
  assert.ok(!connect.text.includes('ls-token-TESTSECRET'), 'connect response hides the token');
  assert.ok(!connect.text.includes(LS_SECRET), 'connect response hides the webhook secret');

  // Wrong store key: no connection there.
  const sale = {
    id: 'LS-SALE-1', status: 'CLOSED', sale_date: '2026-11-14T15:00:00Z', total_price: 24,
    register_sale_products: [{ id: 'p1', product_id: 'PROD-MUG', name: 'Enamel Mug', quantity: 2 }],
  };
  const wrongStore = await postLightspeedSale(sale, 'otherstore');
  assert.equal(wrongStore.status, 404);

  // Bad signature: refused.
  const badSig = await postLightspeedSale(sale, 'tillshop', 'wrong-secret');
  assert.equal(badSig.status, 400);

  // A parked (not closed) sale is acknowledged but never recorded —
  // the later CLOSED delivery for the same id is the one that counts.
  const parked = await postLightspeedSale({ ...sale, status: 'OPEN' });
  assert.equal(parked.status, 200);
  assert.equal(parked.json.recorded, false);
  assert.equal(await eventRow(business.id, 'lightspeed', 'LS-SALE-1'), null);

  // The CLOSED delivery records; the line has no SKU (Lightspeed
  // sale lines carry the product id), so it waits for a mapping.
  const closed = await postLightspeedSale(sale);
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.json.status, 'held_unmatched');
  assert.equal(await onHand(business.id, mug.id, location.id), 10);

  const mapping = await req(`${POS(business.id)}/mappings`, {
    method: 'POST',
    cookie,
    body: { provider: 'lightspeed', provider_item_key: 'product:PROD-MUG', product_id: mug.id },
  });
  assert.equal(mapping.status, 201, mapping.text);
  assert.equal(mapping.json.held_count, 1);
  const appliedHeld = await req(`${POS(business.id)}/mappings/${mapping.json.mapping.id}/apply-held`, {
    method: 'POST',
    cookie,
    body: {},
  });
  assert.equal(appliedHeld.status, 200);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
});

// ============================================================================
// ZETTLE (PayPal Zettle — documented Pusher envelope + signature)
// ============================================================================

const ZT_KEY = 'zettle-signing-TESTSECRET';

function zettleEnvelope(purchase, timestamp = '2026-11-14T15:00:00.812Z') {
  return {
    organizationUuid: 'ORG-UUID-1',
    messageUuid: '803f68c0-a110-11eb-a1cd-f7dd79ee0866',
    eventName: 'PurchaseCreated',
    messageId: '2895af2a-faba-5f51-a1cd-f7dd79ee0866',
    payload: JSON.stringify(purchase),
    timestamp,
  };
}

function zettleSignature(envelope, key = ZT_KEY) {
  return crypto.createHmac('sha256', key).update(`${envelope.timestamp}.${envelope.payload}`, 'utf8').digest('hex');
}

test('Zettle: connect hides the signing key; a signed PurchaseCreated applies by SKU; bad signature/org refused', async () => {
  const { cookie, business, location, mug, journal } = await shopSetup('pos2-zettle@example.com');
  const connect = await req(`${POS(business.id)}/zettle/connect`, {
    method: 'POST',
    cookie,
    body: { organization_uuid: 'ORG-UUID-1', signing_key: ZT_KEY },
  });
  assert.equal(connect.status, 201, connect.text);
  assert.ok(!connect.text.includes(ZT_KEY), 'connect response hides the signing key');

  const purchase = {
    purchaseUuid: 'ZT-PUR-1',
    source: 'POS',
    currency: 'USD',
    amount: 4200,
    timestamp: 1763000000000,
    purchaseNumber: 12776,
    products: [
      { productUuid: 'P-MUG', variantUuid: 'V-MUG', name: 'Enamel Mug', sku: 'SKU-MUG', quantity: '2', type: 'PRODUCT' },
      { productUuid: 'P-JRN', variantUuid: 'V-JRN', name: 'Linen Journal', sku: 'SKU-JRN', quantity: '1', type: 'PRODUCT' },
    ],
  };
  const envelope = zettleEnvelope(purchase);
  const body = JSON.stringify(envelope);

  const bad = await rawPost('/webhooks/pos/zettle', body, { 'x-izettle-signature': 'deadbeef' });
  assert.equal(bad.status, 400);

  const unknownOrg = zettleEnvelope(purchase);
  unknownOrg.organizationUuid = 'ORG-UNKNOWN';
  const unknownBody = JSON.stringify(unknownOrg);
  const orphan = await rawPost('/webhooks/pos/zettle', unknownBody, {
    'x-izettle-signature': zettleSignature(unknownOrg),
  });
  assert.equal(orphan.status, 404);

  const res = await rawPost('/webhooks/pos/zettle', body, { 'x-izettle-signature': zettleSignature(envelope) });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);

  const replay = await rawPost('/webhooks/pos/zettle', body, { 'x-izettle-signature': zettleSignature(envelope) });
  assert.equal(replay.json.duplicate, true);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  // The subscription's own test message is acknowledged, not recorded.
  const testPing = await rawPost('/webhooks/pos/zettle', JSON.stringify({
    eventName: 'TestMessage', organizationUuid: 'ORG-UUID-1', payload: { data: 'payload' },
  }), {});
  assert.equal(testPing.status, 200);
  assert.equal(testPing.json.recorded, false);
});

// ============================================================================
// STRIPE TERMINAL (rides the subscriber's own Stripe account)
// ============================================================================

const ST_SECRET = 'whsec_TESTSECRET0123456789';

function stripeSignature(bodyText, secret = ST_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${bodyText}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postStripeCharge(charge, secret = ST_SECRET) {
  const body = JSON.stringify({ id: 'evt_1', type: 'charge.succeeded', data: { object: charge } });
  return rawPost('/webhooks/pos/stripe-terminal', body, { 'stripe-signature': stripeSignature(body, secret) });
}

test('Stripe Terminal: total-only charges are acknowledged, never recorded; itemized charges apply', async () => {
  const { cookie, business, location, mug } = await shopSetup('pos2-terminal@example.com');
  const badConnect = await req(`${POS(business.id)}/stripe-terminal/connect`, {
    method: 'POST',
    cookie,
    body: { account_id: 'not-an-account', webhook_secret: ST_SECRET },
  });
  assert.equal(badConnect.status, 400);
  const connect = await req(`${POS(business.id)}/stripe-terminal/connect`, {
    method: 'POST',
    cookie,
    body: { account_id: 'acct_TEST123', webhook_secret: ST_SECRET },
  });
  assert.equal(connect.status, 201, connect.text);
  assert.ok(!connect.text.includes(ST_SECRET), 'connect response hides the endpoint secret');

  const bareCharge = {
    id: 'ch_BARE1', amount: 4200, currency: 'usd', created: 1763000000,
    payment_method_details: { type: 'card_present' }, metadata: {},
  };
  const bare = await postStripeCharge(bareCharge);
  assert.equal(bare.status, 200, bare.text);
  assert.equal(bare.json.recorded, false);
  assert.match(bare.json.reason, /no item detail/);
  assert.equal(await eventRow(business.id, 'stripe_terminal', 'ch_BARE1'), null, 'a total-only charge records nothing');

  const wrongSecret = await postStripeCharge(bareCharge, 'whsec_WRONGSECRET012345');
  assert.equal(wrongSecret.status, 400);

  const itemized = {
    ...bareCharge,
    id: 'ch_ITEM1',
    metadata: { stockhaven_items: JSON.stringify([{ sku: 'SKU-MUG', quantity: 2, name: 'Enamel Mug' }]) },
  };
  const res = await postStripeCharge(itemized);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  const replay = await postStripeCharge(itemized);
  assert.equal(replay.json.duplicate, true);
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  // An online (non-Terminal) charge on the same account is not a till sale.
  const online = await postStripeCharge({ ...itemized, id: 'ch_ONLINE1', payment_method_details: { type: 'card' } });
  assert.equal(online.json.recorded, false);
});

// ============================================================================
// WIX (whole body is an RS256 JWT; orders count when PAID)
// ============================================================================

const wixKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const WIX_PUBLIC_PEM = wixKeys.publicKey.export({ type: 'spki', format: 'pem' });
const WIX_PRIVATE_PEM = wixKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });

function base64Url(data) {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wixJwt(envelope, privatePem = WIX_PRIVATE_PEM) {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    data: JSON.stringify(envelope),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privatePem);
  return `${header}.${payload}.${base64Url(signature)}`;
}

function wixOrderEnvelope(order, eventType = 'wix.ecom.v1.order_created') {
  return {
    eventType,
    instanceId: 'WIX-INSTANCE-1',
    data: JSON.stringify({ createdEvent: { entity: order } }),
  };
}

const WIX_ORDER = {
  id: 'WIX-ORDER-1',
  number: '1001',
  createdDate: '2026-11-14T15:00:00.000Z',
  paymentStatus: 'PAID',
  channelInfo: { type: 'POS' },
  priceSummary: { totalPrice: { amount: '42.00', currency: 'USD' } },
  lineItems: [
    { id: 'li1', productName: { original: 'Enamel Mug' }, quantity: 2, sku: 'SKU-MUG', catalogReference: { catalogItemId: 'CAT-MUG' } },
    { id: 'li2', productName: { original: 'Linen Journal' }, quantity: 1, sku: 'SKU-JRN', catalogReference: { catalogItemId: 'CAT-JRN' } },
  ],
};

test('Wix webhook fails closed (503) before the app public key is configured', async () => {
  const res = await rawPost('/webhooks/pos/wix', 'not-a-jwt', {});
  assert.equal(res.status, 503);
  process.env.WIX_PUBLIC_KEY = WIX_PUBLIC_PEM; // configured from here on
});

test('Wix: unpaid orders do not record; a paid POS order applies; a foreign signature is refused', async () => {
  const { cookie, business, location, mug, journal } = await shopSetup('pos2-wix@example.com');
  const connect = await req(`${POS(business.id)}/wix/connect`, {
    method: 'POST',
    cookie,
    body: { instance_id: 'WIX-INSTANCE-1' },
  });
  assert.equal(connect.status, 201, connect.text);

  const unpaid = await rawPost('/webhooks/pos/wix', wixJwt(wixOrderEnvelope({ ...WIX_ORDER, paymentStatus: 'NOT_PAID' })), {
    'Content-Type': 'text/plain',
  });
  assert.equal(unpaid.status, 200, unpaid.text);
  assert.equal(unpaid.json.recorded, false);
  assert.equal(await eventRow(business.id, 'wix', 'WIX-ORDER-1'), null);

  const res = await rawPost('/webhooks/pos/wix', wixJwt(wixOrderEnvelope(WIX_ORDER)), { 'Content-Type': 'text/plain' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);
  const event = await eventRow(business.id, 'wix', 'WIX-ORDER-1');
  assert.match(event.summary, /POS/, 'the channel rides in the summary');

  const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const foreign = await rawPost(
    '/webhooks/pos/wix',
    wixJwt(wixOrderEnvelope({ ...WIX_ORDER, id: 'WIX-ORDER-2' }), otherKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    { 'Content-Type': 'text/plain' },
  );
  assert.equal(foreign.status, 400);
});
