/**
 * T6 — the Walmart scanner set (decided, BOTH plans) + cross-store
 * availability and notify/request (Business by nature).
 *
 *   (1) scan → price + on-hand on the spot (Scan shows the price —
 *       covered by the price assertion on the product record the Scan
 *       page reads; the on-hand per location is the existing levels
 *       list, proven by the movement tests).
 *   (2) shelf counts vs system — CountSheet already shows the
 *       variance (counted vs system) and applies only the differences;
 *       proven by the T3 count tests, not re-proven here.
 *   (3) receiving deliveries against the order — PO receive with
 *       ordered vs received variance, below.
 *   (4) moving stock between aisles (location-to-location).
 *   (6) lookup by name when a barcode won't scan.
 *   (7) marking damaged items + removing them.
 *
 * Cross-store: an item out of stock at this store → the other stores
 * that have it; from the popup, notify that store to ship it or bring
 * it over within ~2 days. Essentials must not see a cross-store
 * section — the server refuses it, and the Scan page only renders the
 * panel on Business.
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
  createBusiness,
  createSupplier,
  createPO,
  receive,
  onHand,
  applySync,
  queuedMovement,
} from './helpers.js';

after(close);

async function businessSetup(email, plan = 'business') {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Aisle 1' });
  return { owner, location };
}

function poLines(product, qty = 10, unitCost = 12.5) {
  return [
    { product_id: product.id, product_name: product.name, sku: product.sku, qty_ordered: qty, qty_received: 0, unit_cost: unitCost },
  ];
}

test('lookup by name finds products when a barcode will not scan', async () => {
  const { owner } = await businessSetup('name-search@example.com', 'essentials');
  await createProducts(owner.cookie, owner.business.id, [
    { name: 'Blue Notebook', sku: 'NB-BLUE', price: 9 },
    { name: 'Blue Pen', sku: 'PEN-BLUE', price: 3 },
    { name: 'Red Notebook', sku: 'NB-RED', price: 9 },
  ]);
  const search = (q) => req(`/api/businesses/${owner.business.id}/products/search?q=${encodeURIComponent(q)}`, { cookie: owner.cookie });

  const blue = await search('blue');
  assert.equal(blue.status, 200);
  assert.deepEqual(blue.json.products.map((p) => p.name).sort(), ['Blue Notebook', 'Blue Pen']);

  const notebook = await search('notebook');
  assert.deepEqual(notebook.json.products.map((p) => p.name).sort(), ['Blue Notebook', 'Red Notebook']);

  const none = await search('purple stapler');
  assert.deepEqual(none.json.products, []);

  const empty = await search('');
  assert.equal(empty.status, 400);

  // Another business's catalog never leaks into the search.
  const stranger = await ownerWithBusiness('name-search-stranger@example.com');
  await createProducts(stranger.cookie, stranger.business.id, [
    { name: 'Blue Notebook', sku: 'NB-BLUE-2', price: 9 },
  ]);
  const again = await search('blue');
  assert.equal(again.json.products.length, 2);
});

test('marking damaged removes stock and stays in the ledger', async () => {
  const { owner, location } = await businessSetup('damaged@example.com', 'essentials');
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Damaged Test Book', sku: 'DMG-001', price: 15 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 5);
  const res = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'damaged', 2, { note: 'Water damage' }),
  ]);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 3);
  const ledger = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id, type: 'damaged' } },
    cookie: owner.cookie,
  });
  assert.equal(ledger.json.items.length, 1);
  assert.equal(ledger.json.items[0].note, 'Water damage');
  assert.equal(ledger.json.items[0].quantity, 2);
});

test('moving stock between aisles moves both sides, never below zero', async () => {
  const { owner, location } = await businessSetup('aisles@example.com', 'essentials');
  // An aisle is a location INSIDE the store's one site (parent_id set),
  // not a second site — Essentials allows one site, aisles within it.
  const aisle2 = await createLocation(owner.cookie, owner.business.id, { name: 'Aisle 2', parent_id: location.id });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Aisle Book', sku: 'AISLE-001', price: 10 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 4);
  const res = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'transfer', 3, { to_location_id: aisle2.id }),
  ]);
  assert.equal(res.json.results[0].status, 'applied');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 1);
  assert.equal(await onHand(owner.business.id, product.id, aisle2.id), 3);

  const tooMuch = await applySync(owner.cookie, owner.business.id, [
    queuedMovement(product.id, location.id, 'transfer', 5, { to_location_id: aisle2.id }),
  ]);
  assert.equal(tooMuch.json.results[0].status, 'failed');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 1);
});

test('receiving a delivery against the order shows the variance', async () => {
  const { owner, location } = await businessSetup('po-receive@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'PO Notebook', sku: 'PO-001', cost: 12.5, price: 20 },
  ]);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    location_name: location.name,
    lines: poLines(product, 10),
  });
  await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`, {
    method: 'POST', cookie: owner.cookie,
  });
  // Only 4 of 10 arrive: the order is partly received, 6 still open.
  const received = await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`, {
    method: 'POST',
    body: { location_id: location.id, receipts: [4] },
    cookie: owner.cookie,
  });
  assert.equal(received.status, 200);
  assert.equal(received.json.status, 'partial');
  assert.equal(received.json.receivedNow, 4);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 4);
  const stored = await req(`/api/entities/PurchaseOrder/${po.id}`, { cookie: owner.cookie });
  const line = stored.json.lines[0];
  assert.equal(line.qty_ordered, 10);
  assert.equal(line.qty_received, 4);
  assert.equal(line.qty_ordered - line.qty_received, 6);
  // The rest arrives: the order completes, variance closes to zero.
  const rest = await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`, {
    method: 'POST',
    body: { location_id: location.id, receipts: [6] },
    cookie: owner.cookie,
  });
  assert.equal(rest.json.status, 'received');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 10);
});

test('cross-store: out of stock here, in stock at the other store', async () => {
  const { owner, location } = await businessSetup('cross-a@example.com');
  const storeB = await createBusiness(owner.cookie, 'Second Store');
  const locationB = await createLocation(owner.cookie, storeB.id, { name: 'Main' });
  const [productA] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Shared Notebook', sku: 'SHARED-001', price: 12 },
  ]);
  const [productB] = await createProducts(owner.cookie, storeB.id, [
    { name: 'Shared Notebook', sku: 'SHARED-001', price: 12 },
  ]);
  await receive(owner.cookie, storeB.id, productB.id, locationB.id, 7);
  assert.equal(await onHand(owner.business.id, productA.id, location.id), 0);

  const availability = await req(
    `/api/businesses/${owner.business.id}/cross-store/availability?product_id=${productA.id}`,
    { cookie: owner.cookie },
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.json.on_hand_here, 0);
  assert.equal(availability.json.stores.length, 1);
  assert.equal(availability.json.stores[0].business_name, 'Second Store');
  assert.equal(availability.json.stores[0].total, 7);
  assert.equal(availability.json.stores[0].locations[0].location_name, 'Main');
});

test('cross-store notify: ship-it request lands in the other store’s inbox', async () => {
  const { owner, location } = await businessSetup('cross-notify@example.com');
  const storeB = await createBusiness(owner.cookie, 'Second Store');
  const locationB = await createLocation(owner.cookie, storeB.id, { name: 'Main' });
  const [productA] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Shared Pen', sku: 'SHARED-002', price: 4 },
  ]);
  const [productB] = await createProducts(owner.cookie, storeB.id, [
    { name: 'Shared Pen', sku: 'SHARED-002', price: 4 },
  ]);
  await receive(owner.cookie, storeB.id, productB.id, locationB.id, 3);

  const request = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: {
      target_business_id: storeB.id,
      product_id: productA.id,
      mode: 'ship',
      message: 'A customer is waiting for this one.',
    },
    cookie: owner.cookie,
  });
  assert.equal(request.status, 201);
  assert.equal(request.json.request.mode, 'ship');
  assert.equal(request.json.request.status, 'open');

  const inbox = await req(`/api/businesses/${storeB.id}/cross-store/requests`, { cookie: owner.cookie });
  assert.equal(inbox.json.incoming.length, 1);
  assert.equal(inbox.json.incoming[0].product_name, 'Shared Pen');
  assert.equal(inbox.json.incoming[0].message, 'A customer is waiting for this one.');
  assert.equal(inbox.json.outgoing.length, 0);

  const resolved = await req(`/api/businesses/${storeB.id}/cross-store/requests/${request.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'resolved' },
    cookie: owner.cookie,
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.request.status, 'resolved');

  // Asking a store that does not have it is refused, not silently queued.
  const storeC = await createBusiness(owner.cookie, 'Third Store');
  const noStock = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: storeC.id, product_id: productA.id, mode: 'bring' },
    cookie: owner.cookie,
  });
  assert.equal(noStock.status, 400);
  assert.equal(noStock.json.error, 'out_of_stock_elsewhere');
});

test('cross-store is Business-only: Essentials gets 403, not an empty list', async () => {
  const { owner, location } = await businessSetup('cross-ess@example.com', 'essentials');
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Essentials Only Book', sku: 'ESS-001', price: 10 },
  ]);
  const availability = await req(
    `/api/businesses/${owner.business.id}/cross-store/availability?product_id=${product.id}`,
    { cookie: owner.cookie },
  );
  assert.equal(availability.status, 403);
  assert.equal(availability.json.error, 'cross_store_business_only');
  const request = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: owner.business.id, product_id: product.id, mode: 'ship' },
    cookie: owner.cookie,
  });
  assert.equal(request.status, 403);
});
