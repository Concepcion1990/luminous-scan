/**
 * T3 shop surface — categories, locations and the site cap, count
 * sessions, orders, returns, listings, dashboard, alerts
 * (Business-only), suppliers (Business-only), and the cross-business
 * move/merge (plan Q-5). Real Express app over HTTP against pg-mem.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  createBusiness,
  createLocation,
  createProducts,
  receive,
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email, plan = null) {
  const owner = await ownerWithBusiness(email);
  if (plan) await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Main store' });
  return { ...owner, location };
}

async function entity(cookie, name, body, method = 'POST', extra = '') {
  return req(`/api/entities/${name}${extra}`, { method, body, cookie });
}

test('categories CRUD and location tree (shelf under a store)', async () => {
  const { cookie, business, location } = await setup('shop-cat@example.com');
  const cat = await entity(cookie, 'Category', { business_id: business.id, name: 'Stationery' });
  assert.equal(cat.status, 201);
  assert.equal(cat.json.name, 'Stationery');
  const shelf = await createLocation(cookie, business.id, {
    name: 'Shelf A',
    kind: 'shelf',
    parent_id: location.id,
    parent_name: location.name,
  });
  assert.equal(shelf.parent_id, location.id);
  const listed = await entity(cookie, 'Location', { filter: { business_id: business.id } }, 'POST', '/query');
  assert.equal(listed.json.items.length, 2);
});

test('Essentials allows exactly one operating site; a second store is refused', async () => {
  const owner = await ownerWithBusiness('shop-site@example.com');
  const { cookie, business } = owner;
  await createLocation(cookie, business.id, { name: 'First store', kind: 'store' });
  const second = await req(`/api/businesses/${business.id}/locations`, {
    method: 'POST',
    body: { location: { name: 'Second store', kind: 'store' } },
    cookie,
  });
  assert.equal(second.status, 403);
  assert.equal(second.json.error, 'site_limit');
  // A shelf under the store is not a site and still fits.
  const shelf = await req(`/api/businesses/${business.id}/locations`, {
    method: 'POST',
    body: { location: { name: 'Shelf', kind: 'shelf', parent_name: 'First store' } },
    cookie,
  });
  assert.equal(shelf.status, 201);
});

test('count sessions: create, add lines, close', async () => {
  const { cookie, business, location } = await setup('shop-count@example.com');
  const [product] = await createProducts(cookie, business.id, [{ name: 'Bookmark', sku: 'BM-1', price: 9 }]);
  const session = await entity(cookie, 'CountSession', {
    business_id: business.id,
    location_id: location.id,
    name: 'Weekly count',
  });
  assert.equal(session.status, 201);
  assert.equal(session.json.status, 'open');
  const withLines = await entity(cookie, 'CountSession', {
    lines: [{ product_id: product.id, counted_qty: 12 }],
  }, 'PATCH', `/${session.json.id}`);
  assert.equal(withLines.status, 200);
  assert.equal(withLines.json.lines.length, 1);
  const closed = await entity(cookie, 'CountSession', { status: 'completed' }, 'PATCH', `/${session.json.id}`);
  assert.equal(closed.json.status, 'completed');
});

test('orders and returns: a sale order, then a return against it', async () => {
  const { cookie, business, location } = await setup('shop-orders@example.com');
  const [product] = await createProducts(cookie, business.id, [{ name: 'Bookmark', sku: 'BM-1', price: 9 }]);
  await receive(cookie, business.id, product.id, location.id, 5);
  const order = await entity(cookie, 'Order', {
    business_id: business.id,
    location_id: location.id,
    type: 'sale',
    lines: [{ product_id: product.id, qty: 2, price: 9 }],
  });
  assert.equal(order.status, 201);
  const returned = await entity(cookie, 'Return', {
    business_id: business.id,
    order_id: order.json.id,
    type: 'refund',
    status: 'pending',
    lines: [{ product_id: product.id, qty: 1, price: 9 }],
  });
  assert.equal(returned.status, 201);
  assert.equal(returned.json.order_id, order.json.id);
});

test('listings: a marketplace listing links back to its product', async () => {
  const { cookie, business } = await setup('shop-listings@example.com');
  const [product] = await createProducts(cookie, business.id, [{ name: 'Bookmark', sku: 'BM-1', price: 9 }]);
  const listing = await entity(cookie, 'Listing', {
    business_id: business.id,
    product_id: product.id,
    platform: 'shopify',
    status: 'active',
    title: 'Handmade bookmark',
  });
  assert.equal(listing.status, 201);
  assert.equal(listing.json.platform, 'shopify');
});

test('dashboard: totals, low stock and valuation in one call', async () => {
  const biz = await setup('shop-dash@example.com', 'business');
  const [low, fine] = await createProducts(biz.cookie, biz.business.id, [
    { name: 'Low stock', sku: 'LOW-1', price: 10, cost: 4, reorder_point: 5 },
    { name: 'Well stocked', sku: 'OK-1', price: 10, cost: 4, reorder_point: 1 },
  ]);
  await receive(biz.cookie, biz.business.id, low.id, biz.location.id, 3);
  await receive(biz.cookie, biz.business.id, fine.id, biz.location.id, 20);

  const dashboard = await req(`/api/businesses/${biz.business.id}/dashboard`, {
    method: 'GET',
    cookie: biz.cookie,
  });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.json.products, 2);
  assert.equal(dashboard.json.totalUnits, 23);
  assert.equal(dashboard.json.lowStock, 1);
  assert.equal(dashboard.json.locations, 1);
  assert.equal(dashboard.json.recentMovements.length, 2);
  assert.equal(dashboard.json.awaitingOrders.length, 0);
});

test('alerts: evaluate flags low stock and out of stock (Business-only)', async () => {
  const ess = await setup('shop-alerts-ess@example.com');
  const denied = await req(`/api/businesses/${ess.business.id}/alerts`, {
    method: 'GET',
    cookie: ess.cookie,
  });
  assert.equal(denied.status, 403);
  const deniedEval = await req(`/api/businesses/${ess.business.id}/alerts/evaluate`, {
    method: 'POST',
    cookie: ess.cookie,
  });
  assert.equal(deniedEval.status, 403);

  const biz = await setup('shop-alerts-biz@example.com', 'business');
  const [low, empty] = await createProducts(biz.cookie, biz.business.id, [
    { name: 'Low', sku: 'LOW-1', price: 5, reorder_point: 5 },
    { name: 'Empty', sku: 'EMP-1', price: 5, reorder_point: 2 },
  ]);
  await receive(biz.cookie, biz.business.id, low.id, biz.location.id, 3);
  // 'Empty' gets stock and then sells out, so it has a level row at zero.
  await receive(biz.cookie, biz.business.id, empty.id, biz.location.id, 2);
  await req(`/api/businesses/${biz.business.id}/movements`, {
    method: 'POST',
    body: { product_id: empty.id, location_id: biz.location.id, type: 'sale', quantity: 2 },
    cookie: biz.cookie,
  });
  // Alert rules drive evaluation: one low-stock rule, one out-of-stock rule.
  await entity(biz.cookie, 'AlertRule', {
    business_id: biz.business.id,
    name: 'Low stock watch',
    kind: 'low_stock',
    threshold: 5,
    active: true,
  });
  await entity(biz.cookie, 'AlertRule', {
    business_id: biz.business.id,
    name: 'Out of stock watch',
    kind: 'out_of_stock',
    threshold: 0,
    active: true,
  });
  const evaluated = await req(`/api/businesses/${biz.business.id}/alerts/evaluate`, {
    method: 'POST',
    cookie: biz.cookie,
  });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.json.triggered.length, 2);
  const byRule = new Map(evaluated.json.triggered.map((row) => [row.rule.name, row.matches]));
  assert.equal(byRule.get('Low stock watch').length, 1);
  assert.equal(byRule.get('Low stock watch')[0].product_id, low.id);
  assert.equal(byRule.get('Out of stock watch').length, 1);
  assert.equal(byRule.get('Out of stock watch')[0].product_id, empty.id);
});

test('suppliers are Business-only (create and list)', async () => {
  const ess = await setup('shop-sup-ess@example.com');
  const denied = await entity(ess.cookie, 'Supplier', {
    business_id: ess.business.id,
    name: 'Paper Co',
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'supplier_business_only');
  // Lists of plan-gated entities skip silently on Essentials (the
  // list pattern): 200 with no rows, never a leak of Business data.
  const deniedList = await entity(ess.cookie, 'Supplier', { filter: { business_id: ess.business.id } }, 'POST', '/query');
  assert.equal(deniedList.status, 200);
  assert.equal(deniedList.json.items.length, 0);

  const biz = await setup('shop-sup-biz@example.com', 'business');
  const created = await entity(biz.cookie, 'Supplier', {
    business_id: biz.business.id,
    name: 'Paper Co',
    email: 'orders@paper.example.com',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.name, 'Paper Co');
});

test('cross-business move: an owner moves stock from one store to another', async () => {
  const owner = await registerVerifiedUser('xmove-owner@example.com');
  const shopA = await createBusiness(owner.cookie, 'Shop A');
  await setPlan(shopA.id, 'business', owner.user.id);
  const shopB = await createBusiness(owner.cookie, 'Shop B');
  const locA = await createLocation(owner.cookie, shopA.id, { name: 'Store A' });
  const locB = await createLocation(owner.cookie, shopB.id, { name: 'Store B' });
  const [product] = await createProducts(owner.cookie, shopA.id, [
    { name: 'Bookmark', sku: 'BM-1', price: 9 },
  ]);
  await receive(owner.cookie, shopA.id, product.id, locA.id, 10);

  const moved = await req(`/api/businesses/${shopA.id}/cross-business-move`, {
    method: 'POST',
    body: {
      target_business_id: shopB.id,
      items: [{ product_id: product.id, location_id: locA.id, to_location_id: locB.id, quantity: 4 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(moved.status, 201);
  assert.equal(moved.json.moved.length, 1);
  const firstMove = moved.json.moved[0];
  assert.equal(firstMove.quantity, 4);
  assert.equal(firstMove.merged, false);
  assert.ok(firstMove.target_product_id);
  assert.notEqual(firstMove.target_product_id, product.id, 'the copy is a distinct product row');

  const inB = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: shopB.id } },
    cookie: owner.cookie,
  });
  assert.equal(inB.json.items.length, 1);
  assert.equal(inB.json.items[0].sku, 'BM-1');
  assert.equal(inB.json.items[0].name, 'Bookmark');

  // Moving more merges into the existing copy instead of duplicating it.
  const again = await req(`/api/businesses/${shopA.id}/cross-business-move`, {
    method: 'POST',
    body: {
      target_business_id: shopB.id,
      items: [{ product_id: product.id, location_id: locA.id, to_location_id: locB.id, quantity: 2 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(again.status, 201);
  assert.equal(again.json.moved[0].merged, true);
  assert.equal(again.json.moved[0].target_product_id, firstMove.target_product_id);
  const levelsB = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: shopB.id } },
    cookie: owner.cookie,
  });
  assert.equal(Number(levelsB.json.items[0].quantity), 6);
});

test('cross-business move refuses a non-owner and refuses more than is on hand', async () => {
  const owner = await registerVerifiedUser('xmove-no@example.com');
  const shopA = await createBusiness(owner.cookie, 'Shop A');
  await setPlan(shopA.id, 'business', owner.user.id);
  const shopB = await createBusiness(owner.cookie, 'Shop B');
  const locA = await createLocation(owner.cookie, shopA.id, { name: 'Store A' });
  const locB = await createLocation(owner.cookie, shopB.id, { name: 'Store B' });
  const [product] = await createProducts(owner.cookie, shopA.id, [{ name: 'Bookmark', sku: 'BM-1' }]);
  await receive(owner.cookie, shopA.id, product.id, locA.id, 2);

  const stranger = await registerVerifiedUser('xmove-stranger@example.com');
  const denied = await req(`/api/businesses/${shopA.id}/cross-business-move`, {
    method: 'POST',
    body: {
      target_business_id: shopB.id,
      items: [{ product_id: product.id, location_id: locA.id, to_location_id: locB.id, quantity: 1 }],
    },
    cookie: stranger.cookie,
  });
  assert.equal(denied.status, 403);
  const over = await req(`/api/businesses/${shopA.id}/cross-business-move`, {
    method: 'POST',
    body: {
      target_business_id: shopB.id,
      items: [{ product_id: product.id, location_id: locA.id, to_location_id: locB.id, quantity: 9 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(over.status, 400);
  assert.equal(over.json.error, 'insufficient_stock');
});
