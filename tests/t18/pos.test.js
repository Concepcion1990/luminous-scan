/**
 * T18 — POS / till connections (POS phase).
 *
 * The owner's decision (Nov 12, 2026): when somebody purchases
 * merchandise at the till, it also reflects in the app's
 * inventory. Square + Shopify POS share one core: per-sale
 * idempotency, SKU/barcode matching + a mapping screen for
 * unmatched items, and a CSV sales-import fallback.
 *
 * Covered: a Square sale and a Shopify order applying stock-out
 * through the ledger; webhook replay never double-counting;
 * unverified webhooks refused (and the receiver failing closed
 * when unconfigured); the unconfigured Square connect answering
 * plainly; unmatched line held → mapping saved → apply-held
 * writes the movement → later sales auto-match; CSV import +
 * same-file re-import no-op + problem rows reported; an
 * insufficient-stock line marked with the event partial and
 * stock never negative; credentials never appearing in any API
 * response; staff read-only on the management surface; a
 * disconnected store's webhooks no longer matching.
 *
 * PLAN GATE (owner's ruling, Nov 13, 2026 — till connections are
 * Business only): Essentials is refused plan_gated on EVERY POS
 * route, reads included; the fixtures run on Business; and the
 * downgrade scenario runs end to end — a sale that arrives while
 * the business is off Business is accepted, recorded held_plan
 * with stock untouched, and applies exactly once after the
 * business returns to Business.
 *
 * Real Express app over HTTP against pg-mem, same as every phase.
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
  registerVerifiedUser,
  ownerWithBusiness,
  createLocation,
  createProducts,
  receive,
  onHand,
  setPlan,
} from './helpers.js';
import { PLANS, COMPARISON_ROWS, WELCOME_OPTIONS } from '../../src/lib/plans.js';

after(close);
beforeEach(() => resetRateLimits());

const POS = (bid) => `/api/businesses/${bid}/pos`;

// Webhook env — the adapters read env at call time, so setting it
// here (after the app booted) is exactly how Fly secrets behave.
const SQUARE_KEY = 'sq-test-signature-key';
const SHOPIFY_SECRET = 'shpss_test_secret';
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SQUARE_KEY;
process.env.SHOPIFY_API_SECRET = SHOPIFY_SECRET;
process.env.SQUARE_WEBHOOK_URL = `${base}/webhooks/pos/square`;
delete process.env.SQUARE_APP_ID;
delete process.env.SQUARE_APP_SECRET;

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

function squareSignature(bodyText) {
  return crypto.createHmac('sha256', SQUARE_KEY)
    .update(`${process.env.SQUARE_WEBHOOK_URL}${bodyText}`, 'utf8')
    .digest('base64');
}

function shopifySignature(bodyText) {
  return crypto.createHmac('sha256', SHOPIFY_SECRET).update(bodyText, 'utf8').digest('base64');
}

async function postSquareOrder(order, merchantId = 'SQ-MERCHANT-1') {
  const payload = {
    merchant_id: merchantId,
    type: 'order.created',
    event_id: crypto.randomUUID(),
    data: { type: 'order', id: order.id, object: { order_created: order } },
  };
  const body = JSON.stringify(payload);
  return rawPost('/webhooks/pos/square', body, { 'x-square-hmacsha256-signature': squareSignature(body) });
}

async function postShopifyOrder(order, domain = 'till-shop.myshopify.com') {
  const body = JSON.stringify(order);
  return rawPost('/webhooks/pos/shopify', body, {
    'x-shopify-hmac-sha256': shopifySignature(body),
    'x-shopify-topic': 'orders/create',
    'x-shopify-shop-domain': domain,
  });
}

// ---- Fixtures -----------------------------------------------------------------

/** Owner + business on the BUSINESS plan (POS is Business only) + location + two stocked products. */
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

/** A connected Square connection, inserted directly (OAuth itself needs real Square keys). */
async function connectSquareSql(businessId, merchantId = 'SQ-MERCHANT-1', token = 'sq-token-TESTSECRET') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pos_connections (id, business_id, provider, status, label, provider_account_id, credentials)
     VALUES ($1, $2, 'square', 'connected', 'Square till', $3, $4)`,
    [id, businessId, merchantId, JSON.stringify({ access_token: token })],
  );
  return id;
}

async function connectShopify(cookie, bid, domain = 'till-shop.myshopify.com', token = 'shpat_TESTSECRETTOKEN') {
  return req(`${POS(bid)}/shopify/connect`, {
    method: 'POST',
    body: { shop_domain: domain, access_token: token },
    cookie,
  });
}

async function movementCount(businessId, referencePart) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1 AND reference LIKE $2',
    [businessId, `%${referencePart}%`],
  );
  return rows[0].n;
}

// ---- Square: a sale at the till moves stock through the ledger ------------------

test('Square sale applies stock-out via the ledger; the recorded event names the sale', async () => {
  const { business, location, mug, journal } = await shopSetup('pos-sq@example.com');
  await connectSquareSql(business.id);

  const res = await postSquareOrder({
    id: 'SQ-ORDER-1',
    location_id: 'SQ-LOC-1',
    created_at: '2026-11-13T15:00:00Z',
    total_money: { amount: 4200, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-MUG', sku: 'SKU-MUG', name: 'Enamel Mug', quantity: '2' },
      { uid: 'l2', catalog_object_id: 'VAR-JRN', sku: 'SKU-JRN', name: 'Linen Journal', quantity: '1' },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.duplicate, false);
  assert.equal(res.json.status, 'applied');

  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);
  assert.equal(await movementCount(business.id, 'POS-square-SQ-ORDER-1'), 2, 'two SALE movements, one per line');

  const { rows } = await pool.query(
    "SELECT * FROM stock_movements WHERE business_id = $1 AND type = 'sale' AND reference = 'POS-square-SQ-ORDER-1'",
    [business.id],
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.user_name === 'Square POS'));
});

// ---- Shopify: an order is a POS sale ----------------------------------------------

test('Shopify order applies; the connect response and overview never carry the token', async () => {
  const { cookie, business, location, mug } = await shopSetup('pos-sh@example.com');
  const connect = await connectShopify(cookie, business.id);
  assert.equal(connect.status, 201);
  assert.equal(connect.json.connection.status, 'connected');
  assert.equal(connect.json.connection.has_credentials, true);
  assert.ok(!connect.text.includes('shpat_TESTSECRETTOKEN'), 'connect response hides the token');

  const res = await postShopifyOrder({
    id: 555001,
    name: '#1001',
    created_at: '2026-11-13T15:05:00Z',
    total_price: '24.00',
    currency: 'USD',
    line_items: [
      { id: 1, product_id: 9001, variant_id: 7001, sku: 'SKU-MUG', name: 'Enamel Mug', quantity: 2 },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  const overview = await req(`${POS(business.id)}/overview`, { cookie });
  assert.equal(overview.status, 200);
  assert.ok(!overview.text.includes('shpat_TESTSECRETTOKEN'), 'overview hides the token');
  const shopifyCard = overview.json.connections.find((c) => c.provider === 'shopify');
  assert.equal(shopifyCard.status, 'connected');
  assert.equal(shopifyCard.provider_account_id, 'till-shop.myshopify.com');
});

// ---- Replay: never double-counts -----------------------------------------------------

test('webhook replay: the same Square sale delivered twice moves stock once', async () => {
  const { business, location, mug } = await shopSetup('pos-replay@example.com');
  await connectSquareSql(business.id, 'SQ-MERCHANT-REPLAY');
  const order = {
    id: 'SQ-ORDER-REPLAY',
    created_at: '2026-11-13T15:10:00Z',
    total_money: { amount: 1200, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-MUG', sku: 'SKU-MUG', name: 'Enamel Mug', quantity: '3' },
    ],
  };
  const first = await postSquareOrder(order, 'SQ-MERCHANT-REPLAY');
  assert.equal(first.json.duplicate, false);
  assert.equal(await onHand(business.id, mug.id, location.id), 7);

  const second = await postSquareOrder(order, 'SQ-MERCHANT-REPLAY');
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  assert.equal(second.json.status, 'applied', 'the recorded outcome is returned');
  assert.equal(await onHand(business.id, mug.id, location.id), 7, 'stock did not move twice');
  assert.equal(await movementCount(business.id, 'POS-square-SQ-ORDER-REPLAY'), 1);
});

// ---- Verification: unverified is refused; unconfigured fails closed ---------------------

test('unverified webhooks are refused; with no key configured the receivers answer 503', async () => {
  const { business } = await shopSetup('pos-verify@example.com');
  await connectSquareSql(business.id, 'SQ-MERCHANT-VERIFY');

  const badSquare = JSON.stringify({ merchant_id: 'SQ-MERCHANT-1', type: 'order.created', data: { object: { order_created: { id: 'X1', line_items: [] } } } });
  const badSig = await rawPost('/webhooks/pos/square', badSquare, { 'x-square-hmacsha256-signature': 'bogus' });
  assert.equal(badSig.status, 400);
  assert.equal(badSig.json.error, 'invalid_signature');

  const badShopify = JSON.stringify({ id: 1, line_items: [] });
  const badHmac = await rawPost('/webhooks/pos/shopify', badShopify, {
    'x-shopify-hmac-sha256': 'bogus',
    'x-shopify-topic': 'orders/create',
    'x-shopify-shop-domain': 'till-shop.myshopify.com',
  });
  assert.equal(badHmac.status, 400);

  const savedKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const savedSecret = process.env.SHOPIFY_API_SECRET;
  delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  delete process.env.SHOPIFY_API_SECRET;
  try {
    const noKey = await rawPost('/webhooks/pos/square', badSquare, { 'x-square-hmacsha256-signature': 'x' });
    assert.equal(noKey.status, 503);
    assert.equal(noKey.json.error, 'pos_not_configured');
    const noSecret = await rawPost('/webhooks/pos/shopify', badShopify, {
      'x-shopify-hmac-sha256': 'x', 'x-shopify-topic': 'orders/create', 'x-shopify-shop-domain': 'till-shop.myshopify.com',
    });
    assert.equal(noSecret.status, 503);
    assert.equal(noSecret.json.error, 'pos_not_configured');
  } finally {
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = savedKey;
    process.env.SHOPIFY_API_SECRET = savedSecret;
  }
});

// ---- The unconfigured connect answers plainly -------------------------------------------

test('Square connect with no Square keys configured answers plainly — no fake connection', async () => {
  const { cookie, business } = await shopSetup('pos-unconf@example.com');
  const res = await req(`${POS(business.id)}/square/connect`, { method: 'POST', body: {}, cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.configured, false);
  assert.match(res.json.message, /not switched on yet/i);
  const { rows } = await pool.query(
    "SELECT * FROM pos_connections WHERE business_id = $1 AND provider = 'square'",
    [business.id],
  );
  assert.equal(rows.length, 0, 'no connection row was faked');
});

// ---- Unmatched → mapping → apply-held → auto-match ----------------------------------------

test('an unmatched item is held (no movement), a mapping applies it, and later sales auto-match', async () => {
  const { cookie, business, location, mug } = await shopSetup('pos-map@example.com');
  await connectSquareSql(business.id, 'SQ-MERCHANT-MAP');

  const held = await postSquareOrder({
    id: 'SQ-ORDER-HELD',
    created_at: '2026-11-13T15:20:00Z',
    total_money: { amount: 2400, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-UNKNOWN-9', name: 'Enamel Mug', variation_name: 'Blue', quantity: '2' },
    ],
  }, 'SQ-MERCHANT-MAP');
  assert.equal(held.json.status, 'held_unmatched');
  assert.equal(await onHand(business.id, mug.id, location.id), 10, 'nothing moved while held');
  assert.equal(await movementCount(business.id, 'POS-square-SQ-ORDER-HELD'), 0);

  const unmatched = await req(`${POS(business.id)}/unmatched`, { cookie });
  assert.equal(unmatched.json.held.length, 1);
  assert.equal(unmatched.json.held[0].provider_item_key, 'VAR-UNKNOWN-9');

  const mapping = await req(`${POS(business.id)}/mappings`, {
    method: 'POST',
    body: { provider: 'square', provider_item_key: 'VAR-UNKNOWN-9', product_id: mug.id },
    cookie,
  });
  assert.equal(mapping.status, 201);
  assert.equal(mapping.json.held_count, 1);

  const applied = await req(`${POS(business.id)}/mappings/${mapping.json.mapping.id}/apply-held`, {
    method: 'POST', body: {}, cookie,
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.applied, 1);
  assert.equal(await onHand(business.id, mug.id, location.id), 8, 'the held sale now counts');
  assert.equal(await movementCount(business.id, 'POS-square-SQ-ORDER-HELD'), 1);

  const events = await req(`${POS(business.id)}/events`, { cookie });
  const heldEvent = events.json.events.find((e) => e.external_sale_id === 'SQ-ORDER-HELD');
  assert.equal(heldEvent.status, 'applied');

  // A later sale of the same catalog item matches on its own.
  const later = await postSquareOrder({
    id: 'SQ-ORDER-LATER',
    created_at: '2026-11-13T16:00:00Z',
    total_money: { amount: 1200, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-UNKNOWN-9', name: 'Enamel Mug', variation_name: 'Blue', quantity: '1' },
    ],
  }, 'SQ-MERCHANT-MAP');
  assert.equal(later.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 7);
});

// ---- CSV fallback ---------------------------------------------------------------------------

test('CSV import applies sales, reports problem rows, and a re-import changes nothing', async () => {
  const { cookie, business, location, mug, journal } = await shopSetup('pos-csv@example.com');
  const csv = [
    'sale_id,sold_at,sku_or_barcode,quantity,item_name,location',
    'EOD-1,2026-11-13 09:00,SKU-MUG,2,Enamel Mug,Main store',
    'EOD-1,2026-11-13 09:00,012345678912,1,Linen Journal,Main store',
    'EOD-2,2026-11-13 09:30,SKU-MUG,1,Enamel Mug,Main store',
    ',2026-11-13 09:40,SKU-MUG,1,No sale id,Main store',
    'EOD-3,2026-11-13 09:50,SKU-MUG,abc,Bad quantity,Main store',
  ].join('\n');

  const first = await req(`${POS(business.id)}/csv-import`, { method: 'POST', body: { csv }, cookie });
  assert.equal(first.status, 200);
  assert.equal(first.json.imported, 2);
  assert.equal(first.json.duplicates, 0);
  assert.equal(first.json.problems.length, 2, 'both bad rows are reported, none silently skipped');
  assert.ok(first.json.problems.some((p) => p.row === 5 && /sale_id/i.test(p.problem)));
  assert.ok(first.json.problems.some((p) => p.row === 6 && /quantity/i.test(p.problem)));
  assert.equal(await onHand(business.id, mug.id, location.id), 7);
  assert.equal(await onHand(business.id, journal.id, location.id), 2, 'the UPC row matched the journal');

  const second = await req(`${POS(business.id)}/csv-import`, { method: 'POST', body: { csv }, cookie });
  assert.equal(second.json.imported, 0);
  assert.equal(second.json.duplicates, 2);
  assert.equal(await onHand(business.id, mug.id, location.id), 7, 're-import never double-counts');
});

// ---- Insufficient stock ------------------------------------------------------------------------

test('a till sale bigger than the shelf: line marked, event partial, stock never negative', async () => {
  const { cookie, business, location, journal } = await shopSetup('pos-short@example.com');
  await connectShopify(cookie, business.id, 'short-shop.myshopify.com');
  const res = await postShopifyOrder({
    id: 555777,
    name: '#1002',
    created_at: '2026-11-13T15:40:00Z',
    total_price: '90.00',
    currency: 'USD',
    line_items: [
      { id: 1, product_id: 9002, variant_id: 7002, sku: 'SKU-JRN', name: 'Linen Journal', quantity: 5 },
    ],
  }, 'short-shop.myshopify.com');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'partially_applied');
  assert.equal(await onHand(business.id, journal.id, location.id), 3, 'stock stayed exactly where it was');

  const events = await req(`${POS(business.id)}/events`, { cookie });
  const event = events.json.events.find((e) => e.external_sale_id === '555777');
  assert.equal(event.lines[0].status, 'insufficient_stock');
  assert.equal(event.lines[0].product_id, journal.id, 'the line still names the product it meant');
});

// ---- Who manages ---------------------------------------------------------------------------------

test('staff can look but cannot connect, map or import; disconnect unmatches the store', async () => {
  const { cookie: ownerCookie, business, user } = await shopSetup('pos-staff@example.com');
  const staffId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Sam Staff', 'pos-staff-member@example.com', 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $3)`,
    [staffId, business.id, user.id],
  );
  const staff = await registerVerifiedUser('pos-staff-member@example.com');

  const look = await req(`${POS(business.id)}/overview`, { cookie: staff.cookie });
  assert.equal(look.status, 200, 'staff can see the till page');

  const connect = await connectShopify(staff.cookie, business.id, 'staff-shop.myshopify.com');
  assert.equal(connect.status, 403);
  const mapping = await req(`${POS(business.id)}/mappings`, {
    method: 'POST',
    body: { provider: 'csv', provider_item_key: 'X', product_id: crypto.randomUUID() },
    cookie: staff.cookie,
  });
  assert.equal(mapping.status, 403);
  const imported = await req(`${POS(business.id)}/csv-import`, {
    method: 'POST',
    body: { csv: 'sale_id,sku_or_barcode,quantity\nA1,SKU-MUG,1' },
    cookie: staff.cookie,
  });
  assert.equal(imported.status, 403);

  // Owner connects, then disconnects: the store's webhooks stop matching.
  await connectShopify(ownerCookie, business.id, 'staff-shop.myshopify.com');
  const before = await postShopifyOrder({
    id: 555888, name: '#1003', created_at: '2026-11-13T16:10:00Z', total_price: '12.00', currency: 'USD',
    line_items: [{ id: 1, product_id: 9001, variant_id: 7001, sku: 'SKU-MUG', name: 'Enamel Mug', quantity: 1 }],
  }, 'staff-shop.myshopify.com');
  assert.equal(before.status, 200);
  const bye = await req(`${POS(business.id)}/connections/shopify/disconnect`, {
    method: 'POST', body: {}, cookie: ownerCookie,
  });
  assert.equal(bye.status, 200);
  assert.equal(bye.json.connection.status, 'not_connected');
  assert.equal(bye.json.connection.has_credentials, false, 'disconnect wipes the stored token');
  const afterRes = await postShopifyOrder({
    id: 555889, name: '#1004', created_at: '2026-11-13T16:20:00Z', total_price: '12.00', currency: 'USD',
    line_items: [{ id: 1, product_id: 9001, variant_id: 7001, sku: 'SKU-MUG', name: 'Enamel Mug', quantity: 1 }],
  }, 'staff-shop.myshopify.com');
  assert.equal(afterRes.status, 404);
  assert.equal(afterRes.json.error, 'connection_not_found');
});

// ---- Plan gate: Essentials is refused everywhere ----------------------------------------------

test('plan gate: Essentials gets plan_gated on every POS route, reads included', async () => {
  const setup = await ownerWithBusiness('pos-gate-ess@example.com', 'Gate Shop');
  const { cookie, business } = setup; // no setPlan: Essentials by default
  await createLocation(cookie, business.id, { name: 'Main store' });

  const attempts = [
    ['GET', `${POS(business.id)}/overview`, undefined],
    ['GET', `${POS(business.id)}/events`, undefined],
    ['GET', `${POS(business.id)}/unmatched`, undefined],
    ['POST', `${POS(business.id)}/square/connect`, {}],
    ['POST', `${POS(business.id)}/shopify/connect`, { shop_domain: 'gate-shop.myshopify.com', access_token: 'shpat_WHATEVER1' }],
    ['POST', `${POS(business.id)}/connections/shopify/disconnect`, {}],
    ['POST', `${POS(business.id)}/connections/shopify/location`, { location_id: crypto.randomUUID() }],
    ['POST', `${POS(business.id)}/mappings`, { provider: 'csv', provider_item_key: 'X', product_id: crypto.randomUUID() }],
    ['POST', `${POS(business.id)}/mappings/${crypto.randomUUID()}/apply-held`, {}],
    ['POST', `${POS(business.id)}/apply-held-plan`, {}],
    ['POST', `${POS(business.id)}/csv-import`, { csv: 'sale_id,sku_or_barcode,quantity\nA1,SKU-MUG,1' }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await req(path, { method, body, cookie });
    assert.equal(res.status, 403, `${method} ${path.split('/pos/')[1]} refuses Essentials`);
    assert.equal(res.json.error, 'plan_gated', `${method} ${path.split('/pos/')[1]} answers plan_gated`);
  }
  const { rows } = await pool.query('SELECT * FROM pos_connections WHERE business_id = $1', [business.id]);
  assert.equal(rows.length, 0, 'no connection was created behind the gate');
});

// ---- Plan gate: the downgrade scenario, end to end -----------------------------------------------

test('plan gate: a sale arriving off-plan is held, never lost, and applies exactly once back on Business', async () => {
  const { cookie: ownerCookie, business, location, mug, user } = await shopSetup('pos-gate-down@example.com');
  await connectSquareSql(business.id, 'SQ-MERCHANT-GATE');

  const orderOne = {
    id: 'SQ-GATE-1',
    created_at: '2026-11-13T17:00:00Z',
    total_money: { amount: 2400, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-MUG', sku: 'SKU-MUG', name: 'Enamel Mug', quantity: '2' },
    ],
  };
  const first = await postSquareOrder(orderOne, 'SQ-MERCHANT-GATE');
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 8);

  // The store downgrades to Essentials. The till keeps selling.
  await setPlan(business.id, 'essentials', user.id);
  const orderTwo = {
    id: 'SQ-GATE-2',
    created_at: '2026-11-13T17:30:00Z',
    total_money: { amount: 3600, currency: 'USD' },
    line_items: [
      { uid: 'l1', catalog_object_id: 'VAR-MUG', sku: 'SKU-MUG', name: 'Enamel Mug', quantity: '3' },
    ],
  };
  const held = await postSquareOrder(orderTwo, 'SQ-MERCHANT-GATE');
  assert.equal(held.status, 200, 'the webhook is still accepted — no provider retry storm');
  assert.equal(held.json.duplicate, false);
  assert.equal(held.json.status, 'held_plan');
  assert.equal(await onHand(business.id, mug.id, location.id), 8, 'stock did not move while held for the plan');
  assert.equal(await movementCount(business.id, 'POS-square-SQ-GATE-2'), 0, 'no movement was written');

  const heldRows = await pool.query(
    "SELECT status FROM pos_sale_events WHERE business_id = $1 AND external_sale_id = 'SQ-GATE-2'",
    [business.id],
  );
  assert.equal(heldRows.rows[0].status, 'held_plan', 'the sale is recorded, not lost');
  const heldLines = await pool.query(
    "SELECT l.status FROM pos_sale_lines l JOIN pos_sale_events e ON e.id = l.event_id WHERE e.business_id = $1 AND e.external_sale_id = 'SQ-GATE-2'",
    [business.id],
  );
  assert.equal(heldLines.rows[0].status, 'held_plan');

  // While Essentials, even reading the till page is refused.
  const gated = await req(`${POS(business.id)}/overview`, { cookie: ownerCookie });
  assert.equal(gated.status, 403);
  assert.equal(gated.json.error, 'plan_gated');

  // Back on Business: the held sale is visible and applies — once.
  await setPlan(business.id, 'business', user.id);
  const overview = await req(`${POS(business.id)}/overview`, { cookie: ownerCookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.held_plan_events, 1);
  const heldEvent = overview.json.events.find((e) => e.external_sale_id === 'SQ-GATE-2');
  assert.equal(heldEvent.status, 'held_plan');
  assert.equal(heldEvent.lines[0].status, 'held_plan');

  const applied = await req(`${POS(business.id)}/apply-held-plan`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.applied, 1);
  assert.equal(await onHand(business.id, mug.id, location.id), 5, 'the held sale now counts');
  assert.equal(await movementCount(business.id, 'POS-square-SQ-GATE-2'), 1);

  // A provider redelivery of the same sale changes nothing.
  const replay = await postSquareOrder(orderTwo, 'SQ-MERCHANT-GATE');
  assert.equal(replay.status, 200);
  assert.equal(replay.json.duplicate, true);
  assert.equal(replay.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 5, 'idempotency intact after the hold');

  const again = await req(`${POS(business.id)}/apply-held-plan`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(again.json.applied, 0, 'nothing left held — a second apply is a no-op');
});

// ---- Plans copy ---------------------------------------------------------------------------------------

test('plans copy: Business presents till connections; Essentials and Mobile do not', () => {
  assert.ok(PLANS.business.includes.some((line) => /till connections/i.test(line)), 'Business includes list names till connections');
  assert.ok(!PLANS.essentials.includes.some((line) => /till connections/i.test(line)), 'Essentials stays truthful');
  const row = COMPARISON_ROWS.find((r) => /till connections/i.test(r.label));
  assert.ok(row, 'a comparison row names till connections');
  assert.equal(row.business, true);
  assert.equal(row.essentials, false);
  assert.equal(row.mobile, false);
});

// ---- Plans parity (owner's rule, Nov 13, 2026) ---------------------------------------------------
// Everything the app has appears on the Plans page AND the Welcome
// page under the plan(s) that include it. The lists below are the
// code-verified placement: both-plan features in BOTH lists,
// Business-only features in Business' lists and nowhere else, and
// a comparison row to match. Welcome and Plans cards render the
// same WELCOME_OPTIONS source, so pinning the data pins both pages.

const welcomeOf = (key) => WELCOME_OPTIONS.find((o) => o.key === key);
const hasLine = (lines, pattern) => lines.some((line) => pattern.test(line));

const BOTH_PLAN_FEATURES = [
  /barcode, upc, isbn and qr scanning/i,
  /product imports/i,
  /product labels/i,
  /stock movements/i,
  /workforce/i,
  /payroll support/i,
  /training lessons/i,
  /team inbox/i,
  /account recovery/i,
  /offline scan queue/i,
  /52 languages/i,
  /your own branding/i,
  /mobile companion included/i,
];

const BUSINESS_ONLY_FEATURES = [
  /up to (5|five) businesses/i,
  /unlimited products/i,
  /custom staff roles/i,
  /stock valuation/i,
  /low-stock alerts/i,
  /csv and excel exports/i,
  /suppliers/i,
  /bundles/i,
  /staff rewards/i,
  /till connections/i,
  /cross-store/i,
  /email purchase orders/i,
  /printable business documents/i,
];

test('plans parity: every both-plan feature is presented in BOTH plans, on Plans and Welcome data', () => {
  const lists = {
    'PLANS.essentials': PLANS.essentials.includes,
    'PLANS.business': PLANS.business.includes,
    'WELCOME.essentials': welcomeOf('essentials').includes,
    'WELCOME.business': welcomeOf('business').includes,
  };
  for (const pattern of BOTH_PLAN_FEATURES) {
    for (const [name, lines] of Object.entries(lists)) {
      assert.ok(hasLine(lines, pattern), `${name} presents ${pattern}`);
    }
  }
});

test('plans parity: every Business-only feature is in Business lists and absent from Essentials lists', () => {
  for (const pattern of BUSINESS_ONLY_FEATURES) {
    assert.ok(hasLine(PLANS.business.includes, pattern), `PLANS.business presents ${pattern}`);
    assert.ok(hasLine(welcomeOf('business').includes, pattern), `WELCOME.business presents ${pattern}`);
    assert.ok(!hasLine(PLANS.essentials.includes, pattern), `PLANS.essentials stays truthful about ${pattern}`);
    assert.ok(!hasLine(welcomeOf('essentials').includes, pattern), `WELCOME.essentials stays truthful about ${pattern}`);
  }
});

test('plans parity: Essentials limits are stated plainly; the trial rides the Welcome lists', () => {
  for (const lines of [PLANS.essentials.includes, welcomeOf('essentials').includes]) {
    assert.ok(hasLine(lines, /one business/i));
    assert.ok(hasLine(lines, /one operating site/i));
    assert.ok(hasLine(lines, /up to 50/i));
    assert.ok(hasLine(lines, /3 additional staff|three additional staff/i));
  }
  assert.ok(hasLine(welcomeOf('essentials').includes, /seven-day trial/i));
  assert.ok(hasLine(welcomeOf('business').includes, /seven-day trial/i));
});

test('plans parity: comparison rows match the lists, and the Mobile staff row tells the solo truth', () => {
  const rowFor = (pattern) => COMPARISON_ROWS.find((r) => pattern.test(r.label));
  for (const pattern of [/workforce/i, /payroll support/i, /training lessons/i, /team inbox/i, /account recovery/i, /offline scan queue/i, /52 languages/i, /your own branding/i, /product imports/i, /product labels/i]) {
    const row = rowFor(pattern);
    assert.ok(row, `a comparison row names ${pattern}`);
    assert.equal(row.essentials, true, `${pattern} row: Essentials ✓`);
    assert.equal(row.business, true, `${pattern} row: Business ✓`);
  }
  for (const pattern of [/cross-store/i, /email purchase orders/i, /printable business documents/i]) {
    const row = rowFor(pattern);
    assert.ok(row, `a comparison row names ${pattern}`);
    assert.equal(row.business, true);
    assert.equal(row.essentials, false);
    assert.equal(row.mobile, false);
  }
  const staffRow = rowFor(/^additional staff$/i);
  assert.ok(staffRow, 'the staff row exists');
  assert.equal(staffRow.mobile, 'Owner only — no staff seats', 'Mobile is solo: one person, no staff seats');
  const trialRow = rowFor(/seven-day free trial/i);
  assert.ok(trialRow, 'a comparison row names the trial');
  assert.equal(trialRow.mobile, true);
  assert.equal(trialRow.essentials, true);
  assert.equal(trialRow.business, true);
});

test('plans parity: Welcome and Plans pages render the same WELCOME_OPTIONS source', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const welcome = fs.readFileSync(path.join(root, 'src/pages/Welcome.jsx'), 'utf8');
  const plans = fs.readFileSync(path.join(root, 'src/pages/Plans.jsx'), 'utf8');
  assert.match(welcome, /WELCOME_OPTIONS\.map/, 'Welcome renders the shared plan options');
  assert.match(plans, /WELCOME_OPTIONS\.map/, 'Plans renders the shared plan options');
  assert.match(plans, /COMPARISON_ROWS\.map/, 'Plans renders the comparison rows');
});
