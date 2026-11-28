/**
 * T60 — eBay storefront sale-sync (release 362, Nov 23, 2026).
 *
 * The owner's rulings: a seller connects their eBay
 * storefront ONCE; from then on an eBay sale drops the
 * product's count itself, with a sale movement recorded —
 * one-way, eBay → app. BOTH PLANS (the Nov 23, 2026
 * connection doctrine: storefront connections are not till
 * connections), with a steps-style training lesson riding in
 * the same release on both plans.
 *
 * Covered: a valid ITEM_SOLD decrements once through the
 * ledger; a duplicate delivery never decrements twice; a bad
 * signature is refused with no state change; an unmatched
 * SKU waits in needs-matching and applies after linking; the
 * order is the truth (a notification applies the fetched
 * order's lines); the catch-up sweep applies a missed sale
 * and never double-applies; BOTH plans open the door (no
 * plan_gated anywhere; an Essentials sale applies);
 * MARKETPLACE_ACCOUNT_DELETION severs + audits; disconnect
 * stops ingestion while history stays; the destination
 * challenge answers with the documented hash; the
 * unconfigured door answers plainly; credentials never reach
 * a response; staff can look but cannot manage; plan
 * presentation + nav + training pins.
 *
 * Release 364 (Nov 23, 2026) — the THREE-KEY matcher, the
 * owner's ruling the same night: a storefront sale matches
 * by "either the SKU and the UPC as well as the ISBN —
 * those three, either or", on BOTH plans. Covered below:
 * a UPC-only line applies; an ISBN-only line applies; an
 * ISBN-10 line matches an ISBN-13 product and the reverse;
 * catalog identifiers arriving in ProductListingDetails
 * match; a key shared by two products holds the sale
 * (never a guessed winner); keys pointing at different
 * products hold the sale; agreeing keys apply exactly
 * once; a replayed UPC-matched sale still applies only
 * once; the sweep road shares the widened matcher; an
 * Essentials sale matched by UPC and by ISBN applies.
 *
 * eBay itself is a fixture here: a test ECDSA keypair stands
 * in for eBay's signing key (the public-key endpoint is
 * stubbed at the fetch seam), and getOrders answers from
 * fixtures — a real eBay round-trip needs the owner's
 * developer keyset, which is the release's publish gate.
 * Real Express app over HTTP against pg-mem, same as every
 * phase. Signatures are computed over the exact bytes sent.
 */
import { test, before, after, beforeEach } from 'node:test';
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
  seededLocation,
  createProducts,
  receive,
  onHand,
  setPlan,
} from './helpers.js';
import { sweepEbayConnection } from '../../server/posEbay.js';
import { PLANS, COMPARISON_ROWS, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { NAV_GROUPS } from '../../src/components/layout/navGroups.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS, lessonVisibleOnPlan } from '../../server/trainingCatalog.js';
import { en } from '../../src/lib/locales/en.js';

after(close);
beforeEach(() => resetRateLimits());

const SF = (bid) => `/api/businesses/${bid}/storefronts`;

// eBay env — the adapter reads env at call time, so setting it
// here (after the app booted) is exactly how Fly secrets behave.
const VERIFICATION_TOKEN = ['t60', 'verification', 'token'].join('-');
process.env.EBAY_APP_ID = 't60-app-id';
process.env.EBAY_CERT_ID = 't60-cert-id';
process.env.EBAY_RU_NAME = 't60-ru-name';
process.env.EBAY_VERIFICATION_TOKEN = VERIFICATION_TOKEN;
process.env.EBAY_WEBHOOK_URL = `${base}/webhooks/pos/ebay`;

// ---- The eBay fixture: a signing keypair + a fetch seam -------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });
/** Orders the stubbed Fulfillment API can serve by id (the notification's order fetch). */
const ordersById = new Map();
const realFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/commerce/notification/v1/public_key/')) {
      return jsonResponse({ key: PUBLIC_PEM, algorithm: 'ECDSA', digest: 'SHA256' });
    }
    if (href.includes('/oauth2/revoke')) {
      return jsonResponse({});
    }
    if (href.includes('/identity/v1/oauth2/token')) {
      return jsonResponse({ access_token: ['t60', 'app', 'token'].join('-'), expires_in: 7200, refresh_token: ['t60', 'refresh', 'token'].join('-') });
    }
    const single = href.match(/\/sell\/fulfillment\/v1\/order\/([^/?]+)$/);
    if (single) {
      const order = ordersById.get(decodeURIComponent(single[1]));
      return order ? jsonResponse(order) : jsonResponse({ errors: [{ errorId: 1100 }] }, 404);
    }
    return realFetch(url, options);
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

function ebaySignatureHeader(bodyText) {
  const signature = crypto
    .sign('sha256', Buffer.from(bodyText, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');
  return Buffer.from(JSON.stringify({ alg: 'ECDSA', kid: 't60-kid', signature }), 'utf8').toString('base64');
}

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

async function postEbayNotification(payload) {
  const body = JSON.stringify(payload);
  return rawPost('/webhooks/pos/ebay', body, { 'x-ebay-signature': ebaySignatureHeader(body) });
}

function itemSold({ orderId, username = 'fixture_seller', lines }) {
  return {
    metadata: { topic: 'ITEM_SOLD', schemaVersion: '1.0' },
    notification: {
      notificationId: crypto.randomUUID(),
      eventDate: '2026-11-23T20:00:00.000Z',
      publishDate: '2026-11-23T20:00:00.000Z',
      data: { orderId, username, lineItems: lines },
    },
  };
}

// ---- Fixtures ---------------------------------------------------------------------

let seq = 0;
const uniqEmail = (label) => `${label}${++seq}@example.com`;

/** Owner + business on the given plan + location + two stocked products. */
async function storeSetup(email, plan = 'business') {
  const setup = await ownerWithBusiness(email, 'Storefront Shop');
  if (plan) await setPlan(setup.business.id, plan, setup.user.id);
  const location = await seededLocation(setup.cookie, setup.business.id);
  const [mug, journal] = await createProducts(setup.cookie, setup.business.id, [
    { name: 'Enamel Mug', sku: 'SKU-MUG', price: 12 },
    { name: 'Linen Journal', sku: 'SKU-JRN', price: 18 },
  ]);
  await receive(setup.cookie, setup.business.id, mug.id, location.id, 10);
  await receive(setup.cookie, setup.business.id, journal.id, location.id, 3);
  return { ...setup, location, mug, journal };
}

const EBAY_TOKEN = 'ebay-token-TESTSECRET';

/** A connected eBay connection, inserted directly (OAuth itself needs the owner's real keyset).
 *  Each fixture carries a UNIQUE seller identity: in production one eBay
 *  account belongs to one business (a reconnect elsewhere severs the old
 *  connection), so two live fixtures must never share a seller. */
async function connectEbaySql(businessId, locationId, { sellerId = `EBAYUSER-${++seq}`, username = `seller_${seq}` } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pos_connections (id, business_id, provider, status, label, provider_account_id, credentials, location_id)
     VALUES ($1, $2, 'ebay', 'connected', $3, $4, $5, $6)`,
    [id, businessId, username, sellerId, JSON.stringify({
      access_token: EBAY_TOKEN,
      refresh_token: ['ebay', 'refresh', 'TESTSECRET'].join('-'),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }), locationId],
  );
  return { id, sellerId, username };
}

async function movementCount(businessId, referencePart) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1 AND reference LIKE $2',
    [businessId, `%${referencePart}%`],
  );
  return rows[0].n;
}

async function eventCount(businessId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM pos_sale_events WHERE business_id = $1 AND provider = 'ebay'",
    [businessId],
  );
  return rows[0].n;
}

// ---- A valid sale decrements once, through the ledger --------------------------------

test('valid ITEM_SOLD decrements once; the movement carries the eBay order reference', async () => {
  const { business, location, mug, journal } = await storeSetup(uniqEmail('ebay-sale'));
  const conn = await connectEbaySql(business.id, location.id);

  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-1',
    username: conn.username,
    lines: [
      { lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 2, title: 'Enamel Mug' },
      { lineItemId: 'li2', itemId: 'ITEM-JRN', sku: 'SKU-JRN', quantity: 1, title: 'Linen Journal' },
    ],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.duplicate, false);
  assert.equal(res.json.status, 'applied');

  assert.equal(await onHand(business.id, mug.id, location.id), 8);
  assert.equal(await onHand(business.id, journal.id, location.id), 2);
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-1'), 2, 'two SALE movements, one per line');

  const { rows } = await pool.query(
    "SELECT * FROM stock_movements WHERE business_id = $1 AND type = 'sale' AND reference = 'POS-ebay-EB-ORDER-1'",
    [business.id],
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.note === 'Sold on eBay'), 'the movement says where the sale happened');
  assert.ok(rows.every((r) => r.user_name === 'eBay'));
});

test('duplicate ITEM_SOLD delivery never decrements twice', async () => {
  const { business, location, mug } = await storeSetup(uniqEmail('ebay-dupe'));
  const conn = await connectEbaySql(business.id, location.id);
  const payload = itemSold({
    orderId: 'EB-ORDER-DUPE',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 3, title: 'Enamel Mug' }],
  });
  const first = await postEbayNotification(payload);
  assert.equal(first.json.duplicate, false);
  assert.equal(await onHand(business.id, mug.id, location.id), 7);

  const second = await postEbayNotification(payload);
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  assert.equal(second.json.status, 'applied', 'the recorded outcome is returned');
  assert.equal(await onHand(business.id, mug.id, location.id), 7, 'stock did not move twice');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-DUPE'), 1);
});

// ---- Verification: unverified is refused, nothing changes ------------------------------

test('bad signature is refused with no state change; a missing signature likewise', async () => {
  const { business, location, mug } = await storeSetup(uniqEmail('ebay-badsig'));
  await connectEbaySql(business.id, location.id);
  const payload = itemSold({
    orderId: 'EB-ORDER-FORGED',
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  });
  const body = JSON.stringify(payload);

  const forged = await rawPost('/webhooks/pos/ebay', body, { 'x-ebay-signature': 'bogus' });
  assert.equal(forged.status, 400);
  assert.equal(forged.json.error, 'invalid_signature');

  const unsigned = await rawPost('/webhooks/pos/ebay', body, {});
  assert.equal(unsigned.status, 400);

  // A well-formed header over DIFFERENT bytes (a tampered body) also fails.
  const other = ebaySignatureHeader(JSON.stringify({ tampered: true }));
  const tampered = await rawPost('/webhooks/pos/ebay', body, { 'x-ebay-signature': other });
  assert.equal(tampered.status, 400);

  assert.equal(await eventCount(business.id), 0, 'nothing was recorded');
  assert.equal(await onHand(business.id, mug.id, location.id), 10, 'stock untouched');
});

// ---- Needs matching: held, visible, resolvable ------------------------------------------

test('unmatched SKU waits in needs-matching; linking applies the held sale', async () => {
  const { cookie, business, location, mug } = await storeSetup(uniqEmail('ebay-match'));
  const conn = await connectEbaySql(business.id, location.id);

  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-UNKNOWN',
    username: conn.username,
    lines: [{ lineItemId: 'li9', itemId: 'ITEM-MYSTERY', sku: 'SKU-UNKNOWN', quantity: 2, title: 'Mystery Item' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'held_unmatched');
  assert.equal(await onHand(business.id, mug.id, location.id), 10, 'nothing moved yet');

  const overview = await req(`${SF(business.id)}/overview`, { cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.unmatched.length, 1, 'the held sale is visible and countable');
  assert.equal(overview.json.unmatched[0].provider_item_key, 'ITEM-MYSTERY');
  assert.equal(overview.json.unmatched[0].external_sale_id, 'EB-ORDER-UNKNOWN');

  const mapping = await req(`${SF(business.id)}/mappings`, {
    method: 'POST',
    body: { provider_item_key: 'ITEM-MYSTERY', product_id: mug.id },
    cookie,
  });
  assert.equal(mapping.status, 201);
  assert.equal(mapping.json.held_count, 1);

  const applied = await req(`${SF(business.id)}/mappings/${mapping.json.mapping.id}/apply-held`, {
    method: 'POST', body: {}, cookie,
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.applied, 1);
  assert.equal(await onHand(business.id, mug.id, location.id), 8, 'the held sale recorded itself');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-UNKNOWN'), 1);

  const after = await req(`${SF(business.id)}/overview`, { cookie });
  assert.equal(after.json.unmatched.length, 0, 'nothing left waiting');
});

// ---- The order is the truth ---------------------------------------------------------------

test('a notification applies the fetched order lines, not just the lines it carried', async () => {
  const { business, location, mug, journal } = await storeSetup(uniqEmail('ebay-truth'));
  const conn = await connectEbaySql(business.id, location.id);
  ordersById.set('EB-ORDER-FULL', {
    orderId: 'EB-ORDER-FULL',
    creationDate: '2026-11-23T20:05:00.000Z',
    pricingSummary: { total: { value: '42.00', currency: 'USD' } },
    lineItems: [
      { lineItemId: 'li1', legacyItemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' },
      { lineItemId: 'li2', legacyItemId: 'ITEM-JRN', sku: 'SKU-JRN', quantity: 2, title: 'Linen Journal' },
    ],
  });
  // The notification itself names only the first line.
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-FULL',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 9);
  assert.equal(await onHand(business.id, journal.id, location.id), 1, 'the order second line applied too');
  ordersById.delete('EB-ORDER-FULL');
});

// ---- The catch-up sweep ---------------------------------------------------------------------

test('catch-up sweep applies a missed sale and never double-applies it', async () => {
  const { business, location, mug } = await storeSetup(uniqEmail('ebay-sweep'));
  const { id: connectionId } = await connectEbaySql(business.id, location.id);
  const { rows } = await pool.query('SELECT * FROM pos_connections WHERE id = $1', [connectionId]);
  const connection = rows[0];

  const missedOrder = {
    orderId: 'EB-ORDER-MISSED',
    creationDate: '2026-11-23T19:00:00.000Z',
    pricingSummary: { total: { value: '24.00', currency: 'USD' } },
    lineItems: [{ lineItemId: 'li1', legacyItemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 2, title: 'Enamel Mug' }],
  };
  const stubFetch = async (url) => {
    const href = String(url);
    if (href.includes('/sell/fulfillment/v1/order?')) return jsonResponse({ orders: [missedOrder] });
    return jsonResponse({}, 404);
  };

  const first = await sweepEbayConnection(pool, connection, { fetchImpl: stubFetch, logger: { error() {} } });
  assert.equal(first.error, null);
  assert.equal(first.applied, 1);
  assert.equal(await onHand(business.id, mug.id, location.id), 8, 'the missed sale landed');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-MISSED'), 1);

  const second = await sweepEbayConnection(pool, connection, { fetchImpl: stubFetch, logger: { error() {} } });
  assert.equal(second.duplicates, 1, 'the same order is the recorded outcome, not a second sale');
  assert.equal(await onHand(business.id, mug.id, location.id), 8, 'stock did not move twice');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-MISSED'), 1);

  const state = await pool.query('SELECT * FROM ebay_sweep_state WHERE connection_id = $1', [connectionId]);
  assert.ok(state.rows[0]?.last_sweep_at, 'the watermark advanced');
});

// ---- Release 364: the three-key matcher ---------------------------------------------------------

/** Owner + business + location + three products keyed three different ways. */
async function bookSetup(email, plan = 'business') {
  const setup = await ownerWithBusiness(email, 'Keyed Books');
  if (plan) await setPlan(setup.business.id, plan, setup.user.id);
  const location = await seededLocation(setup.cookie, setup.business.id);
  const [krypton, phonics, atlas] = await createProducts(setup.cookie, setup.business.id, [
    { name: 'The Last Days of Krypton', sku: 'SKU-KRYPTON', isbn: '9780061340741', price: 14 },
    { name: 'Hooked on Phonics', sku: 'SKU-PHONICS', upc: '012345678905', price: 9 },
    { name: 'World Atlas', sku: 'SKU-ATLAS', upc: '555000111222', isbn: '9783161484100', price: 22 },
  ]);
  await receive(setup.cookie, setup.business.id, krypton.id, location.id, 5);
  await receive(setup.cookie, setup.business.id, phonics.id, location.id, 4);
  await receive(setup.cookie, setup.business.id, atlas.id, location.id, 6);
  return { ...setup, location, krypton, phonics, atlas };
}

test('three keys: a UPC-only line applies (hyphens and spaces are just printing)', async () => {
  const { business, location, phonics } = await bookSetup(uniqEmail('ebay-upc'));
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-UPC',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-PHONICS', upc: '0-12345-67890-5', quantity: 2, title: 'Hooked on Phonics' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the UPC alone carries the match');
  assert.equal(await onHand(business.id, phonics.id, location.id), 2);
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-UPC'), 1);
});

test('three keys: an ISBN-only line applies', async () => {
  const { business, location, krypton } = await bookSetup(uniqEmail('ebay-isbn'));
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-ISBN',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-KRYPTON', isbn: '9780061340741', quantity: 1, title: 'The Last Days of Krypton' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the ISBN alone carries the match');
  assert.equal(await onHand(business.id, krypton.id, location.id), 4);
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-ISBN'), 1);
});

test('three keys: an ISBN-10 line matches the product carrying the ISBN-13 form', async () => {
  const { business, location, krypton } = await bookSetup(uniqEmail('ebay-isbn10'));
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-ISBN10',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-KRYPTON', isbn: '0-06-134074-X', quantity: 2, title: 'The Last Days of Krypton' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the same book in its other printed form still matches');
  assert.equal(await onHand(business.id, krypton.id, location.id), 3);
});

test('three keys: an ISBN-13 line matches the product carrying the ISBN-10 form', async () => {
  const setup = await ownerWithBusiness(uniqEmail('ebay-isbn13'), 'Ten Form Books');
  await setPlan(setup.business.id, 'business', setup.user.id);
  const location = await seededLocation(setup.cookie, setup.business.id);
  const [book] = await createProducts(setup.cookie, setup.business.id, [
    { name: 'The Last Days of Krypton', sku: 'SKU-K10', isbn: '006134074X', price: 14 },
  ]);
  await receive(setup.cookie, setup.business.id, book.id, location.id, 3);
  const conn = await connectEbaySql(setup.business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-ISBN13',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-K10', isbn: '978-0-06-134074-1', quantity: 1, title: 'The Last Days of Krypton' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the equivalence runs both ways');
  assert.equal(await onHand(setup.business.id, book.id, location.id), 2);
});

test('three keys: catalog identifiers in ProductListingDetails match (payload lines are the record)', async () => {
  const { business, location, krypton } = await bookSetup(uniqEmail('ebay-catalog'));
  const conn = await connectEbaySql(business.id, location.id);
  // No order waits at the fetch seam for this id, so the
  // notification's own lines are the record — and they carry
  // the catalog block eBay supplies for catalog listings.
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-CATALOG',
    username: conn.username,
    lines: [{
      lineItemId: 'li1', itemId: 'ITEM-KRYPTON', quantity: 1, title: 'The Last Days of Krypton',
      productListingDetails: { ISBN: '9780061340741' },
    }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the supplied catalog ISBN carries the match');
  assert.equal(await onHand(business.id, krypton.id, location.id), 4);
});

test('three keys: a UPC shared by two products holds the sale — never a guessed winner', async () => {
  const { cookie, business, location } = await bookSetup(uniqEmail('ebay-ambig'));
  const conn = await connectEbaySql(business.id, location.id);
  // Two live products carrying the SAME UPC — a catalog
  // state the create road discourages but a real shelf can
  // reach (planted directly, as the connection fixtures are).
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [i, id] of ids.entries()) {
    await pool.query(
      `INSERT INTO products (id, business_id, name, sku, upc, price, status)
       VALUES ($1, $2, $3, $4, '777777777777', 5, 'active')`,
      [id, business.id, `Shared UPC Book ${i + 1}`, `SKU-SHARED-${i + 1}`],
    );
    await receive(cookie, business.id, id, location.id, 3);
  }
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-AMBIG',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-SHARED', upc: '777777777777', quantity: 1, title: 'Shared UPC Book' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'held_unmatched', 'one key, two products: a person decides');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-AMBIG'), 0, 'nothing was applied');
  for (const id of ids) {
    assert.equal(await onHand(business.id, id, location.id), 3, 'neither twin lost stock to a guess');
  }
});

test('three keys: keys pointing at different products hold the sale', async () => {
  const { business, location, krypton, phonics } = await bookSetup(uniqEmail('ebay-conflict'));
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-CONFLICT',
    username: conn.username,
    // The SKU says Krypton; the UPC says Phonics. Both are
    // real — so nobody decides but a person.
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MIXED', sku: 'SKU-KRYPTON', upc: '012345678905', quantity: 1, title: 'Mixed Signals' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'held_unmatched', 'conflicting keys never pick a winner');
  assert.equal(await onHand(business.id, krypton.id, location.id), 5, 'the SKU product did not move');
  assert.equal(await onHand(business.id, phonics.id, location.id), 4, 'the UPC product did not move');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-CONFLICT'), 0);
});

test('three keys: agreeing keys apply exactly once', async () => {
  const { business, location, atlas } = await bookSetup(uniqEmail('ebay-agree'));
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-AGREE',
    username: conn.username,
    lines: [{
      lineItemId: 'li1', itemId: 'ITEM-ATLAS',
      sku: 'sku-atlas', upc: '555000111222', isbn: '978-3-16-148410-0',
      quantity: 2, title: 'World Atlas',
    }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'all three keys agree on the atlas (SKU case aside)');
  assert.equal(await onHand(business.id, atlas.id, location.id), 4);
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-AGREE'), 1, 'one line, one movement — agreement is not triple-counted');
});

test('three keys: a replayed UPC-matched sale still applies only once', async () => {
  const { business, location, phonics } = await bookSetup(uniqEmail('ebay-replay'));
  const conn = await connectEbaySql(business.id, location.id);
  const payload = itemSold({
    orderId: 'EB-ORDER-UPC-REPLAY',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-PHONICS', upc: '012345678905', quantity: 1, title: 'Hooked on Phonics' }],
  });
  const first = await postEbayNotification(payload);
  assert.equal(first.json.status, 'applied');
  assert.equal(await onHand(business.id, phonics.id, location.id), 3);
  const second = await postEbayNotification(payload);
  assert.equal(second.json.duplicate, true);
  assert.equal(await onHand(business.id, phonics.id, location.id), 3, 'the anchor holds whichever key matched');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-UPC-REPLAY'), 1);
});

test('three keys: the catch-up sweep shares the widened matcher', async () => {
  const { business, location, krypton } = await bookSetup(uniqEmail('ebay-sweep-keys'));
  const { id: connectionId } = await connectEbaySql(business.id, location.id);
  const { rows } = await pool.query('SELECT * FROM pos_connections WHERE id = $1', [connectionId]);
  const connection = rows[0];
  const missedOrder = {
    orderId: 'EB-ORDER-SWEEP-ISBN',
    creationDate: '2026-11-23T19:30:00.000Z',
    pricingSummary: { total: { value: '28.00', currency: 'USD' } },
    lineItems: [{ lineItemId: 'li1', legacyItemId: 'ITEM-KRYPTON', isbn: '9780061340741', quantity: 2, title: 'The Last Days of Krypton' }],
  };
  const stubFetch = async (url) => {
    const href = String(url);
    if (href.includes('/sell/fulfillment/v1/order?')) return jsonResponse({ orders: [missedOrder] });
    return jsonResponse({}, 404);
  };
  const first = await sweepEbayConnection(pool, connection, { fetchImpl: stubFetch, logger: { error() {} } });
  assert.equal(first.error, null);
  assert.equal(first.applied, 1, 'the sweep matched by ISBN through the same matcher');
  assert.equal(await onHand(business.id, krypton.id, location.id), 3);
  const second = await sweepEbayConnection(pool, connection, { fetchImpl: stubFetch, logger: { error() {} } });
  assert.equal(second.duplicates, 1);
  assert.equal(await onHand(business.id, krypton.id, location.id), 3);
});

test('three keys: an Essentials sale matched by UPC and by ISBN applies', async () => {
  const { business, location, krypton, phonics } = await bookSetup(uniqEmail('ebay-ess-keys'), 'essentials');
  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-ESS-KEYS',
    username: conn.username,
    lines: [
      { lineItemId: 'li1', itemId: 'ITEM-PHONICS', upc: '012345678905', quantity: 1, title: 'Hooked on Phonics' },
      { lineItemId: 'li2', itemId: 'ITEM-KRYPTON', isbn: '0-06-134074-X', quantity: 2, title: 'The Last Days of Krypton' },
    ],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'the three-key match is both plans, like the door itself');
  assert.equal(await onHand(business.id, phonics.id, location.id), 3);
  assert.equal(await onHand(business.id, krypton.id, location.id), 3);
});

// ---- Both plans open the door -----------------------------------------------------------------

test('both plans: Essentials opens the door, connects, and an Essentials sale applies', async () => {
  const { cookie, business, location, mug } = await storeSetup(uniqEmail('ebay-ess'), 'essentials');

  const overview = await req(`${SF(business.id)}/overview`, { cookie });
  assert.equal(overview.status, 200, 'no plan_gated on the storefront door');
  assert.equal(overview.json.configured, true);
  assert.equal(overview.json.connection.status, 'not_connected');

  const connect = await req(`${SF(business.id)}/ebay/connect`, { method: 'POST', body: {}, cookie });
  assert.equal(connect.status, 200);
  assert.equal(connect.json.configured, true);
  assert.ok(connect.json.authorize_url.includes('auth.ebay.com/oauth2/authorize'), 'the OAuth door opens');
  assert.ok(connect.json.authorize_url.includes('sell.fulfillment.readonly'), 'the fulfillment scope rides along');

  const conn = await connectEbaySql(business.id, location.id);
  const res = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-ESS',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'applied', 'an Essentials sale applies — storefronts are both plans');
  assert.equal(await onHand(business.id, mug.id, location.id), 9);
});

test('credentials never appear in the overview response', async () => {
  const { cookie, business, location } = await storeSetup(uniqEmail('ebay-secret'));
  await connectEbaySql(business.id, location.id);
  const overview = await req(`${SF(business.id)}/overview`, { cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.connection.status, 'connected');
  assert.equal(overview.json.connection.has_credentials, true);
  assert.ok(!overview.text.includes(EBAY_TOKEN), 'overview hides the token');
  assert.ok(!overview.text.includes('ebay-refresh'), 'overview hides the refresh token');
});

test('staff can look but cannot manage the connection', async () => {
  const { cookie: ownerCookie, business, user } = await storeSetup(uniqEmail('ebay-staff'));
  const staffId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Sam Staff', $3, 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $4)`,
    [staffId, business.id, uniqEmail('ebay-staff-member'), user.id],
  );
  const staffEmail = await pool.query('SELECT email FROM staff_members WHERE id = $1', [staffId]);
  const staff = await registerVerifiedUser(staffEmail.rows[0].email);

  const look = await req(`${SF(business.id)}/overview`, { cookie: staff.cookie });
  assert.equal(look.status, 200, 'staff can see the storefront page');

  const connect = await req(`${SF(business.id)}/ebay/connect`, { method: 'POST', body: {}, cookie: staff.cookie });
  assert.equal(connect.status, 403);
  assert.equal(connect.json.message, 'Storefront connections are managed by the owner or a manager.');
  const disconnect = await req(`${SF(business.id)}/ebay/disconnect`, { method: 'POST', body: {}, cookie: staff.cookie });
  assert.equal(disconnect.status, 403);
  const mapping = await req(`${SF(business.id)}/mappings`, {
    method: 'POST',
    body: { provider_item_key: 'X', product_id: crypto.randomUUID() },
    cookie: staff.cookie,
  });
  assert.equal(mapping.status, 403);
  assert.ok(ownerCookie, 'owner fixture used');
});

// ---- Account deletion + disconnect --------------------------------------------------------------

test('MARKETPLACE_ACCOUNT_DELETION severs the connection and audits; later sales find no door', async () => {
  const { business, location, mug } = await storeSetup(uniqEmail('ebay-deletion'));
  const fixture = await connectEbaySql(business.id, location.id);

  const res = await postEbayNotification({
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0' },
    notification: {
      notificationId: crypto.randomUUID(),
      eventDate: '2026-11-23T21:00:00.000Z',
      publishDate: '2026-11-23T21:00:00.000Z',
      data: { userId: fixture.sellerId, username: fixture.username, email: 'seller@example.com' },
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.recorded, true);
  assert.equal(res.json.action, 'connection_severed');

  const conn = await pool.query("SELECT * FROM pos_connections WHERE business_id = $1 AND provider = 'ebay'", [business.id]);
  assert.equal(conn.rows[0].status, 'not_connected');
  assert.equal(conn.rows[0].credentials, '', 'the credential material is gone');
  const audit = await pool.query('SELECT * FROM ebay_account_deletions WHERE ebay_user_id = $1', [fixture.sellerId]);
  assert.equal(audit.rows.length, 1, 'the handling is audited');
  assert.equal(audit.rows[0].action, 'connection_severed');

  const sale = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-AFTER-DELETE',
    username: fixture.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  }));
  assert.equal(sale.status, 200);
  assert.equal(sale.json.recorded, false, 'no connection, no ingestion');
  assert.equal(await onHand(business.id, mug.id, location.id), 10);
});

test('disconnect stops ingestion; the recorded sales stay', async () => {
  const { cookie, business, location, mug } = await storeSetup(uniqEmail('ebay-bye'));
  const conn = await connectEbaySql(business.id, location.id);

  const first = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-BEFORE-BYE',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  }));
  assert.equal(first.json.status, 'applied');
  assert.equal(await onHand(business.id, mug.id, location.id), 9);

  const bye = await req(`${SF(business.id)}/ebay/disconnect`, { method: 'POST', body: {}, cookie });
  assert.equal(bye.status, 200);
  assert.equal(bye.json.connection.status, 'not_connected');
  assert.equal(bye.json.connection.has_credentials, false, 'disconnect wipes the stored tokens');

  const afterSale = await postEbayNotification(itemSold({
    orderId: 'EB-ORDER-AFTER-BYE',
    username: conn.username,
    lines: [{ lineItemId: 'li1', itemId: 'ITEM-MUG', sku: 'SKU-MUG', quantity: 1, title: 'Enamel Mug' }],
  }));
  assert.equal(afterSale.status, 200);
  assert.equal(afterSale.json.recorded, false);
  assert.equal(await onHand(business.id, mug.id, location.id), 9, 'no sale lands after disconnect');
  assert.equal(await eventCount(business.id), 1, 'the sale recorded before disconnect stays in history');
  assert.equal(await movementCount(business.id, 'POS-ebay-EB-ORDER-BEFORE-BYE'), 1);
});

// ---- Destination verification + the unconfigured door ----------------------------------------------

test('destination verification challenge answers with the documented hash', async () => {
  const res = await fetch(`${base}/webhooks/pos/ebay?challenge_code=challenge-123`);
  assert.equal(res.status, 200);
  const json = await res.json();
  const expected = crypto
    .createHash('sha256')
    .update(`challenge-123${VERIFICATION_TOKEN}${base}/webhooks/pos/ebay`, 'utf8')
    .digest('hex');
  assert.equal(json.challengeResponse, expected);
});

test('not configured: the connect door answers plainly and the overview says so', async () => {
  const saved = {
    app: process.env.EBAY_APP_ID, cert: process.env.EBAY_CERT_ID, ru: process.env.EBAY_RU_NAME,
  };
  delete process.env.EBAY_APP_ID;
  delete process.env.EBAY_CERT_ID;
  delete process.env.EBAY_RU_NAME;
  try {
    const { cookie, business } = await storeSetup(uniqEmail('ebay-unconf'), 'essentials');
    const overview = await req(`${SF(business.id)}/overview`, { cookie });
    assert.equal(overview.status, 200);
    assert.equal(overview.json.configured, false, 'the door shows its not-available state');
    const connect = await req(`${SF(business.id)}/ebay/connect`, { method: 'POST', body: {}, cookie });
    assert.equal(connect.status, 200);
    assert.equal(connect.json.configured, false);
    assert.match(connect.json.message, /not switched on yet/);
    const hook = await postEbayNotification(itemSold({ orderId: 'EB-X', lines: [] }));
    assert.equal(hook.status, 503, 'the receiver fails closed while unconfigured');
  } finally {
    process.env.EBAY_APP_ID = saved.app;
    process.env.EBAY_CERT_ID = saved.cert;
    process.env.EBAY_RU_NAME = saved.ru;
  }
});

// ---- Presentation: plans, nav, training --------------------------------------------------------------

test('plan presentation: the eBay line rides BOTH plans (Plans + Welcome + comparison)', () => {
  const line = en['plansLib.includes.ebaySync'];
  assert.ok(line, 'the plan line exists in English');
  assert.ok(PLANS.essentials.includes.includes(line), 'PLANS Essentials carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'the Welcome Essentials card carries the line');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row, 'the comparison table has the row');
  assert.equal(row.essentials, true);
  assert.equal(row.business, true);
});

test('nav: the storefronts door sits in Sales with no plan gate', () => {
  const sales = NAV_GROUPS.find((g) => g.labelKey === 'nav.group.sales');
  assert.ok(sales, 'the Sales group exists');
  const door = sales.items.find((i) => i.to === '/storefronts');
  assert.ok(door, 'the door exists');
  assert.equal(door.feature, undefined, 'no feature tag — both plans see it');
  assert.equal(door.perm, undefined, 'no perm gate — every member sees it');
  assert.equal(door.labelKey, 'nav.storefronts');
});

test('training: catalog 117, the eBay lesson agrees across catalogs and shows on both plans', () => {
  assert.equal(CLIENT_LESSONS.length, 134);
  assert.equal(SERVER_LESSONS.length, 134);
  const server = SERVER_LESSONS.find((l) => l.id === 'owner-ebay-connect');
  const client = CLIENT_LESSONS.find((l) => l.id === 'owner-ebay-connect');
  assert.ok(server && client, 'the lesson exists in both catalogs');
  assert.deepEqual(
    { track: server.track, module: server.module, steps: server.steps, feature: server.feature },
    { track: client.track, module: client.module, steps: client.steps, feature: client.feature },
  );
  assert.equal(server.track, 'owner');
  assert.equal(server.module, 'storefronts');
  assert.equal(server.steps, 5);
  assert.equal(server.feature, undefined, 'no feature tag — the lesson is on both plans');
  assert.equal(lessonVisibleOnPlan(server, false), true, 'visible on Essentials');
  assert.equal(lessonVisibleOnPlan(server, true), true, 'visible on Business');
  assert.ok(en['training.lessons.owner-ebay-connect.title'], 'the lesson has a title');
  for (let s = 1; s <= 5; s += 1) {
    assert.ok(en[`training.lessons.owner-ebay-connect.step${s}`], `step ${s} has words`);
  }
  assert.equal(en['training.module.storefronts'], 'Storefront connections');
});
