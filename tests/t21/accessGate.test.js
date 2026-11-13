/**
 * T21 — server-side subscription access gate (2026-11-13 loophole fix).
 *
 * Before this gate, the screens bounced an unpaid workspace to /plans
 * but the API served everything: a fresh business with NO entitlement
 * row could create/read products, scan, sync, use workforce and
 * training (reproduced against da730e5: create 201, reads 200).
 * These tests pin the server rule: only a Stripe-confirmed trial or
 * payment unlocks business data — through EVERY surface — while the
 * pre-checkout/account flows and the products-only grace view keep
 * working exactly as designed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  req, pool, close, registerVerifiedUser,
  createBusiness, createLocation, createProducts,
  setPlan, setEntitlement, ownerWithBusiness,
} from '../t3/helpers.js';
import {
  assessSubscriptionAccess,
  hasFullSubscriptionAccess,
  PUBLISHER_OWNER_EMAIL,
} from '../../server/subscriptionAccess.js';

after(close);

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const GRANDFATHERED_ID = '6aeaec9b141cfe26e5a411be';

// ---- The pure assessor -------------------------------------------------

test('assessor: only granting states are full; everything else fails closed', () => {
  const now = new Date();
  const biz = { id: 'biz-1', owner_id: 'u1', created_by_id: 'u1' };
  const user = { id: 'u1', email: 'owner@example.com' };
  const at = (record, opts = {}) => assessSubscriptionAccess(record, { user, business: biz, now, ...opts }).state;

  assert.equal(at(null), 'denied', 'no entitlement row');
  assert.equal(at({ status: 'pending_checkout', plan: 'essentials' }), 'denied');
  assert.equal(at({ status: 'mystery_status', plan: 'essentials' }), 'denied', 'unknown status');
  assert.equal(at({ status: 'active', plan: 'essentials' }), 'full');
  assert.equal(at({ status: 'trialing', plan: 'business', trial_ends_at: iso(now.getTime() + 3 * DAY) }), 'full');
  assert.equal(at({ status: 'past_due', plan: 'essentials' }), 'full');
  assert.equal(at({ status: 'canceled', plan: 'essentials', period_ends_at: iso(now.getTime() + 5 * DAY) }), 'full', 'canceled inside paid period');
  assert.equal(at({ status: 'canceled', plan: 'essentials', period_ends_at: iso(now.getTime() - 1 * DAY) }), 'grace');
  assert.equal(at({ status: 'canceled', plan: 'essentials', period_ends_at: iso(now.getTime() - 14 * DAY) }), 'grace');
  assert.equal(at({ status: 'canceled', plan: 'essentials', period_ends_at: iso(now.getTime() - 16 * DAY) }), 'denied', 'past grace');
  assert.equal(at({ status: 'canceled', plan: 'essentials', period_ends_at: null }), 'denied', 'canceled with no date');
  // Grandfathered: an ordinary customer NEVER qualifies.
  assert.equal(at({ status: 'grandfathered', plan: 'business' }), 'denied', 'grandfathered row, ordinary business');
  const gfBiz = { id: GRANDFATHERED_ID, owner_id: 'u1', created_by_id: 'u1' };
  assert.equal(
    assessSubscriptionAccess({ status: 'grandfathered', plan: 'business' }, { user, business: gfBiz, now }).state,
    'full',
    'the publisher workspace itself, viewed by its creator-owner',
  );
  assert.equal(
    assessSubscriptionAccess({ status: 'grandfathered', plan: 'essentials' }, { user, business: gfBiz, now }).state,
    'denied',
    'grandfathered must be the Business plan row',
  );
  const stranger = { id: 'u9', email: 'stranger@example.com' };
  assert.equal(
    assessSubscriptionAccess({ status: 'grandfathered', plan: 'business' }, { user: stranger, business: gfBiz, now }).state,
    'denied',
    'grandfathered workspace, non-publisher caller',
  );
});

// ---- Unpaid workspace: every surface refuses ---------------------------

async function entitledShopWithData(email) {
  const owner = await ownerWithBusiness(email, 'Gate Shop', { plan: 'business' });
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Main' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Gate Widget', sku: 'GATE-1', isbn: '9780143127741', price: 10 },
  ]);
  return { ...owner, location, product };
}

async function stripEntitlement(businessId) {
  await pool.query('DELETE FROM entitlements WHERE business_id = $1', [businessId]);
}

test('unpaid owner (no entitlement row) is denied on read, write, scan, entity, workforce, training, POS, sync', async () => {
  const { cookie, business, location, product } = await entitledShopWithData('gate-unpaid@example.com');
  const bid = business.id;
  await stripEntitlement(bid);

  const denied = async (label, promise) => {
    const res = await promise;
    assert.equal(res.status, 403, `${label}: expected 403, got ${res.status} ${res.text}`);
    assert.equal(res.json?.error, 'subscription_required', `${label}: error code`);
  };

  await denied('entity query', req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } }));
  await denied('entity get', req(`/api/entities/Product/${product.id}`, { cookie }));
  await denied('entity create', req('/api/entities/Product', { method: 'POST', cookie, body: { business_id: bid, name: 'Sneaky', sku: 'SNEAK-1' } }));
  await denied('REST create product', req(`/api/businesses/${bid}/products`, { method: 'POST', cookie, body: { business_id: bid, products: [{ name: 'Sneaky', sku: 'SNEAK-2' }] } }));
  await denied('dashboard read', req(`/api/businesses/${bid}/dashboard`, { cookie }));
  await denied('scan lookup', req(`/api/businesses/${bid}/scan/lookup`, { method: 'POST', cookie, body: { code: 'GATE-1' } }));
  await denied('movement write', req(`/api/businesses/${bid}/movements`, { method: 'POST', cookie, body: { product_id: product.id, location_id: location.id, type: 'receive', quantity: 1 } }));
  await denied('export read', req(`/api/businesses/${bid}/export/products`, { cookie }));
  await denied('workforce read', req(`/api/businesses/${bid}/workforce/people`, { cookie }));
  await denied('training read', req(`/api/businesses/${bid}/training/state`, { cookie }));
  await denied('rewards read', req(`/api/businesses/${bid}/workforce/rewards`, { cookie }));
  await denied('POS overview', req(`/api/businesses/${bid}/pos/overview`, { cookie }));
  await denied('sync state', req(`/api/businesses/${bid}/sync/state`, { cookie }));
  await denied('sync apply', req(`/api/businesses/${bid}/sync/apply`, { method: 'POST', cookie, body: { ops: [] } }));
  await denied('settings patch', req(`/api/businesses/${bid}`, { method: 'PATCH', cookie, body: { name: 'Renamed' } }));

  // And nothing leaked or changed underneath: the catalog is intact
  // for the day the workspace actually subscribes.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1', [bid]);
  assert.equal(rows[0].n, 1, 'the denied writes created nothing');
});

test('unpaid owner keeps every pre-checkout and account flow', async () => {
  const { cookie, business } = await entitledShopWithData('gate-precheckout@example.com');
  const bid = business.id;
  await stripEntitlement(bid);

  const list = await req('/api/businesses', { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.items?.some((b) => b.id === bid), 'business list still shows the workspace');

  const entitlement = await req(`/api/businesses/${bid}/entitlement`, { cookie });
  assert.equal(entitlement.status, 200);
  assert.equal(entitlement.json.entitlement, null, 'entitlement read reports the missing row');

  const entEntity = await req('/api/entities/Entitlement/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } });
  assert.equal(entEntity.status, 200, 'Entitlement entity stays readable (state discovery)');

  const status = await req(`/api/billing/status?business_id=${bid}`, { cookie });
  assert.equal(status.status, 200, 'billing status read works');

  const eligibility = await req(`/api/billing/trial-eligibility?business_id=${bid}`, { cookie });
  assert.notEqual(eligibility.json?.error, 'subscription_required', 'trial eligibility is not gate-refused');
  assert.notEqual(eligibility.status, 403, 'trial eligibility passes the gate (its own Stripe-config posture is separate)');

  const switched = await req(`/api/businesses/${bid}/switch`, { method: 'POST', cookie, body: {} });
  assert.equal(switched.status, 200, 'workspace switch works');
});

test('pending_checkout is denied exactly like no row', async () => {
  const { cookie, business } = await entitledShopWithData('gate-pending@example.com');
  await setEntitlement(business.id, { plan: 'essentials', status: 'pending_checkout' });
  const read = await req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: business.id } } });
  assert.equal(read.status, 403);
  assert.equal(read.json.error, 'subscription_required');
  const dash = await req(`/api/businesses/${business.id}/dashboard`, { cookie });
  assert.equal(dash.status, 403);
});

// ---- Granting states ----------------------------------------------------

test('trialing owner is allowed in full', async () => {
  const { cookie, business, user } = await ownerWithBusiness('gate-trial@example.com');
  await setEntitlement(business.id, {
    plan: 'essentials', status: 'trialing', trialEndsAt: iso(Date.now() + 6 * DAY), ownerId: user.id,
  });
  const created = await req(`/api/businesses/${business.id}/products`, {
    method: 'POST', cookie, body: { business_id: business.id, products: [{ name: 'Trial Widget', sku: 'TRIAL-1' }] },
  });
  assert.equal(created.status, 201);
  const read = await req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: business.id } } });
  assert.equal(read.status, 200);
  assert.equal(read.json.items.length, 1);
});

test('past_due owner keeps access', async () => {
  const { cookie, business } = await entitledShopWithData('gate-pastdue@example.com');
  await setEntitlement(business.id, { plan: 'business', status: 'past_due' });
  const read = await req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: business.id } } });
  assert.equal(read.status, 200);
  assert.equal(read.json.items.length, 1);
});

test('canceled inside the paid period keeps full access', async () => {
  const { cookie, business } = await entitledShopWithData('gate-cancel-paid@example.com');
  await setEntitlement(business.id, {
    plan: 'business', status: 'canceled', periodEndsAt: iso(Date.now() + 10 * DAY),
  });
  const created = await req(`/api/businesses/${business.id}/products`, {
    method: 'POST', cookie, body: { business_id: business.id, products: [{ name: 'Still Mine', sku: 'PAID-1' }] },
  });
  assert.equal(created.status, 201, 'writes still work until the paid-through date');
  const scan = await req(`/api/businesses/${business.id}/scan/lookup`, { method: 'POST', cookie, body: { code: 'GATE-1' } });
  assert.equal(scan.status, 200);
});

// ---- Grace ----------------------------------------------------------------

test('grace: products + stock levels readable, everything else refuses read-only', async () => {
  const { cookie, business, location, product } = await entitledShopWithData('gate-grace@example.com');
  const bid = business.id;
  const received = await req(`/api/businesses/${bid}/movements`, {
    method: 'POST', cookie, body: { product_id: product.id, location_id: location.id, type: 'receive', quantity: 3 },
  });
  assert.equal(received.status, 201);
  await setEntitlement(bid, { plan: 'business', status: 'canceled', periodEndsAt: iso(Date.now() - 2 * DAY) });

  const products = await req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } });
  assert.equal(products.status, 200, 'the migration view: products stay readable');
  assert.equal(products.json.items.length, 1);
  assert.equal(products.json.items[0].sku, 'GATE-1');
  const levels = await req('/api/entities/StockLevel/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } });
  assert.equal(levels.status, 200, 'stock levels stay readable');
  const one = await req(`/api/entities/Product/${product.id}`, { cookie });
  assert.equal(one.status, 200, 'single product read stays open');

  const readOnly = async (label, promise) => {
    const res = await promise;
    assert.equal(res.status, 403, `${label}: expected 403, got ${res.status}`);
    assert.equal(res.json?.error, 'grace_read_only', `${label}: error code`);
  };
  await readOnly('dashboard', req(`/api/businesses/${bid}/dashboard`, { cookie }));
  await readOnly('entity create', req('/api/entities/Product', { method: 'POST', cookie, body: { business_id: bid, name: 'Nope', sku: 'NOPE-1' } }));
  await readOnly('scan (scanner use)', req(`/api/businesses/${bid}/scan/lookup`, { method: 'POST', cookie, body: { code: 'GATE-1' } }));
  await readOnly('export', req(`/api/businesses/${bid}/export/products`, { cookie }));
  await readOnly('workforce', req(`/api/businesses/${bid}/workforce/people`, { cookie }));
  await readOnly('staff entity list', req('/api/entities/StaffMember/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } }));

  const entitlement = await req(`/api/businesses/${bid}/entitlement`, { cookie });
  assert.equal(entitlement.status, 200, 'entitlement read still works in grace');
});

test('past grace: no business data at all, account + billing essentials still work', async () => {
  const { cookie, business } = await entitledShopWithData('gate-pastgrace@example.com');
  const bid = business.id;
  await setEntitlement(bid, { plan: 'business', status: 'canceled', periodEndsAt: iso(Date.now() - 20 * DAY) });

  const read = await req('/api/entities/Product/query', { method: 'POST', cookie, body: { filter: { business_id: bid } } });
  assert.equal(read.status, 403);
  assert.equal(read.json.error, 'subscription_required');
  const dash = await req(`/api/businesses/${bid}/dashboard`, { cookie });
  assert.equal(dash.status, 403);

  const list = await req('/api/businesses', { cookie });
  assert.equal(list.status, 200, 'can still see the workspace to resubscribe or delete');
  const status = await req(`/api/billing/status?business_id=${bid}`, { cookie });
  assert.equal(status.status, 200);
  const switched = await req(`/api/businesses/${bid}/switch`, { method: 'POST', cookie, body: {} });
  assert.equal(switched.status, 200);
});

// ---- Staff + cross-business ----------------------------------------------

test('staff of an unpaid workspace are denied too', async () => {
  const { cookie, business, user } = await entitledShopWithData('gate-staff@example.com');
  const bid = business.id;
  const staff = await registerVerifiedUser('gate-staff-member@example.com');
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, role_id, status, created_by_id, created_by)
     VALUES ($1, $2, 'Gate Staff', $3, 'preset-stock', 'active', $4, $5)`,
    [crypto.randomUUID(), bid, staff.email, user.id, user.email],
  );
  const before = await req('/api/entities/Product/query', { method: 'POST', cookie: staff.cookie, body: { filter: { business_id: bid } } });
  assert.equal(before.status, 200, 'staff read works while entitled');

  await stripEntitlement(bid);
  const after = await req('/api/entities/Product/query', { method: 'POST', cookie: staff.cookie, body: { filter: { business_id: bid } } });
  assert.equal(after.status, 403);
  assert.equal(after.json.error, 'subscription_required');
  const dash = await req(`/api/businesses/${bid}/dashboard`, { cookie: staff.cookie });
  assert.equal(dash.status, 403);
});

test('cross-business move refuses an unpaid target workspace', async () => {
  const owner = await ownerWithBusiness('gate-xmove@example.com', 'Source', { plan: 'business' });
  const sourceLoc = await createLocation(owner.cookie, owner.business.id, { name: 'Src' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [{ name: 'Mover', sku: 'MOVE-1', price: 5 }]);
  await req(`/api/businesses/${owner.business.id}/movements`, {
    method: 'POST', cookie: owner.cookie,
    body: { product_id: product.id, location_id: sourceLoc.id, type: 'receive', quantity: 4 },
  });
  const target = await createBusiness(owner.cookie, 'Target');
  await setPlan(target.id, 'business', owner.user.id);
  const targetLoc = await createLocation(owner.cookie, target.id, { name: 'Dst' });
  await stripEntitlement(target.id);

  const moved = await req(`/api/businesses/${owner.business.id}/cross-business-move`, {
    method: 'POST', cookie: owner.cookie,
    body: { target_business_id: target.id, items: [{ product_id: product.id, location_id: sourceLoc.id, to_location_id: targetLoc.id, quantity: 1 }] },
  });
  assert.equal(moved.status, 403);
  assert.equal(moved.json.error, 'subscription_required');
});

// ---- Grandfathered / complimentary -----------------------------------------

async function cloneBusinessWithId(sourceId, newId) {
  const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [sourceId]);
  const row = rows[0];
  const cols = Object.keys(row);
  const values = cols.map((c) => (c === 'id' ? newId : row[c]));
  await pool.query(
    `INSERT INTO businesses (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    values,
  );
}

test('grandfathered: ordinary customer gets nothing; the publisher workspace works', async () => {
  // (a) Ordinary owner + a grandfathered Business row on their own
  // (non-publisher) workspace: NOT a grant.
  const ordinary = await ownerWithBusiness('gate-gf-ordinary@example.com', 'Ordinary', { grant: false });
  await setEntitlement(ordinary.business.id, { plan: 'business', status: 'grandfathered', ownerId: ordinary.user.id });
  const denied = await req('/api/entities/Product/query', {
    method: 'POST', cookie: ordinary.cookie, body: { filter: { business_id: ordinary.business.id } },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'subscription_required');

  // (b) The publisher's own complimentary workspace (the real
  // grandfathered business id, owned + created by its owner, with a
  // grandfathered Business row): full access, no subscription.
  const publisher = await registerVerifiedUser(PUBLISHER_OWNER_EMAIL);
  const shell = await createBusiness(publisher.cookie, 'Publisher Workspace');
  await cloneBusinessWithId(shell.id, GRANDFATHERED_ID);
  await setEntitlement(GRANDFATHERED_ID, { plan: 'business', status: 'grandfathered', ownerId: publisher.user.id });
  const created = await req(`/api/businesses/${GRANDFATHERED_ID}/products`, {
    method: 'POST', cookie: publisher.cookie,
    body: { business_id: GRANDFATHERED_ID, products: [{ name: 'Comp Widget', sku: 'COMP-1' }] },
  });
  assert.equal(created.status, 201, 'complimentary workspace creates');
  const read = await req('/api/entities/Product/query', {
    method: 'POST', cookie: publisher.cookie, body: { filter: { business_id: GRANDFATHERED_ID } },
  });
  assert.equal(read.status, 200);
  assert.equal(read.json.items.length, 1);

  // (c) A staff member on that workspace is NOT the publisher: denied.
  const staffer = await registerVerifiedUser('gate-gf-staff@example.com');
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, role_id, status, created_by_id, created_by)
     VALUES ($1, $2, 'Comp Staff', $3, 'preset-stock', 'active', $4, $5)`,
    [crypto.randomUUID(), GRANDFATHERED_ID, staffer.email, publisher.user.id, publisher.email],
  );
  const staffRead = await req('/api/entities/Product/query', {
    method: 'POST', cookie: staffer.cookie, body: { filter: { business_id: GRANDFATHERED_ID } },
  });
  assert.equal(staffRead.status, 403, 'grandfathered access belongs to the publisher alone');
});

// ---- POS webhook predicate ---------------------------------------------------

test('POS hold predicate: only full access applies a till sale', async () => {
  const { business } = await entitledShopWithData('gate-pos@example.com');
  assert.equal(await hasFullSubscriptionAccess(pool, business.id), true, 'active Business applies');
  await setEntitlement(business.id, { plan: 'business', status: 'canceled', periodEndsAt: iso(Date.now() - 1 * DAY) });
  assert.equal(await hasFullSubscriptionAccess(pool, business.id), false, 'grace holds the sale');
  await stripEntitlement(business.id);
  assert.equal(await hasFullSubscriptionAccess(pool, business.id), false, 'unpaid holds the sale');
});
