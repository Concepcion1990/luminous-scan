/**
 * T3 movements — receive / adjust / count / transfer (both sides),
 * reserve + release, reversal, the never-negative rule, and the
 * bundle-type gate on Essentials. Real Express app over HTTP
 * against pg-mem.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createLocation,
  createProducts,
  receive,
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email) {
  const owner = await ownerWithBusiness(email);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Main store' });
  const shelf = await createLocation(owner.cookie, owner.business.id, {
    name: 'Shelf A',
    kind: 'shelf',
    parent_id: location.id,
    parent_name: location.name,
  });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Bookmark', sku: 'BM-1', price: 9, cost: 2, reorder_point: 2 },
  ]);
  return { ...owner, location, shelf, product };
}

async function levels(cookie, businessId) {
  const res = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  return res.json.items;
}

async function move(cookie, businessId, body) {
  return req(`/api/businesses/${businessId}/movements`, { method: 'POST', body, cookie });
}

test('receive then sale: levels move and the ledger records both', async () => {
  const { cookie, business, location, product } = await setup('mv-basic@example.com');
  const received = await receive(cookie, business.id, product.id, location.id, 10);
  assert.equal(received.next, 10);
  assert.equal(received.previous, 0);
  assert.equal(received.movement.type, 'receive');
  assert.equal(received.movement.new_qty, 10);

  const sold = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'sale',
    quantity: 3,
  });
  assert.equal(sold.status, 201);
  assert.equal(sold.json.next, 7);

  const rows = await levels(cookie, business.id);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].quantity), 7);
});

test('stock never goes below zero: an over-sale is refused and writes nothing', async () => {
  const { cookie, business, location, product } = await setup('mv-neg@example.com');
  await receive(cookie, business.id, product.id, location.id, 2);
  const over = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'sale',
    quantity: 5,
  });
  assert.equal(over.status, 400);
  assert.equal(over.json.error, 'insufficient_stock');
  const rows = await levels(cookie, business.id);
  assert.equal(Number(rows[0].quantity), 2);
  const ledger = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id } },
    cookie,
  });
  assert.equal(ledger.json.items.length, 1, 'only the receive is in the ledger');
});

test('count sets the exact on-hand quantity', async () => {
  const { cookie, business, location, product } = await setup('mv-count@example.com');
  await receive(cookie, business.id, product.id, location.id, 10);
  const counted = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'count',
    quantity: 4,
  });
  assert.equal(counted.json.next, 4);
  assert.equal(counted.json.movement.previous_qty, 10);
});

test('transfer writes both sides: out of one location, into the other', async () => {
  const { cookie, business, location, shelf, product } = await setup('mv-xfer@example.com');
  await receive(cookie, business.id, product.id, location.id, 10);
  const moved = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'transfer',
    quantity: 4,
    to_location_id: shelf.id,
  });
  assert.equal(moved.status, 201);
  assert.equal(moved.json.next, 6);
  const rows = await levels(cookie, business.id);
  const byLocation = new Map(rows.map((row) => [row.location_id, Number(row.quantity)]));
  assert.equal(byLocation.get(location.id), 6);
  assert.equal(byLocation.get(shelf.id), 4);
  const ledger = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id }, sort: 'created_date' },
    cookie,
  });
  const types = ledger.json.items.map((row) => row.type);
  assert.deepEqual(types, ['receive', 'transfer', 'transfer_in']);
});

test('transfer refuses more than is on hand, and a transfer to another business is refused', async () => {
  const { cookie, business, location, shelf, product } = await setup('mv-xfer-neg@example.com');
  await receive(cookie, business.id, product.id, location.id, 3);
  const over = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'transfer',
    quantity: 9,
    to_location_id: shelf.id,
  });
  assert.equal(over.status, 400);
  const other = await ownerWithBusiness('mv-xfer-other@example.com', 'Other shop');
  const otherLocation = await createLocation(other.cookie, other.business.id, { name: 'Elsewhere' });
  const cross = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'transfer',
    quantity: 1,
    to_location_id: otherLocation.id,
  });
  assert.equal(cross.status, 400);
  assert.equal(cross.json.error, 'invalid_reference');
});

test('reserve holds stock without removing it; release frees it again', async () => {
  const { cookie, business, location, product } = await setup('mv-reserve@example.com');
  await receive(cookie, business.id, product.id, location.id, 10);
  const held = await req(`/api/businesses/${business.id}/reserve`, {
    method: 'POST',
    body: { product_id: product.id, location_id: location.id, type: 'reserved', quantity: 4 },
    cookie,
  });
  assert.equal(held.status, 201);
  assert.equal(held.json.next, 4);
  const rows = await levels(cookie, business.id);
  assert.equal(Number(rows[0].quantity), 10, 'on hand is unchanged by a hold');
  assert.equal(Number(rows[0].reserved), 4);
  const tooMuch = await req(`/api/businesses/${business.id}/reserve`, {
    method: 'POST',
    body: { product_id: product.id, location_id: location.id, type: 'reserved', quantity: 7 },
    cookie,
  });
  assert.equal(tooMuch.status, 400);
  const freed = await req(`/api/businesses/${business.id}/reserve`, {
    method: 'POST',
    body: { product_id: product.id, location_id: location.id, type: 'released', quantity: 4 },
    cookie,
  });
  assert.equal(freed.json.next, 0);
});

test('reversal writes a mirror entry and never edits the original', async () => {
  const { cookie, business, location, product } = await setup('mv-reverse@example.com');
  const received = await receive(cookie, business.id, product.id, location.id, 8);
  const movementId = received.movement.id;
  const reversed = await req(`/api/businesses/${business.id}/movements/${movementId}/reverse`, {
    method: 'POST',
    cookie,
  });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.json.next, 0);
  assert.equal(reversed.json.movement.type, 'correction');
  assert.equal(reversed.json.movement.reversal_of_id, movementId);
  // A reversal cannot itself be reversed.
  const again = await req(`/api/businesses/${business.id}/movements/${reversed.json.movement.id}/reverse`, {
    method: 'POST',
    cookie,
  });
  assert.equal(again.status, 400);
  // A transfer cannot be reversed (move it back with a new transfer).
  await receive(cookie, business.id, product.id, location.id, 5);
  const ledger = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id, type: 'transfer' } },
    cookie,
  });
  assert.equal(ledger.json.items.length, 0);
  const shelf = await createLocation(cookie, business.id, {
    name: 'Shelf B',
    kind: 'shelf',
    parent_id: location.id,
  });
  await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'transfer',
    quantity: 2,
    to_location_id: shelf.id,
  });
  const transfers = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id, type: 'transfer' } },
    cookie,
  });
  const noReverse = await req(
    `/api/businesses/${business.id}/movements/${transfers.json.items[0].id}/reverse`,
    { method: 'POST', cookie },
  );
  assert.equal(noReverse.status, 400);
});

test('bundle movement types refuse on Essentials and pass on Business', async () => {
  const ess = await setup('mv-bundle-ess@example.com');
  await receive(ess.cookie, ess.business.id, ess.product.id, ess.location.id, 5);
  const refused = await move(ess.cookie, ess.business.id, {
    product_id: ess.product.id,
    location_id: ess.location.id,
    type: 'consume',
    quantity: 1,
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'bundle_business_only');

  const biz = await setup('mv-bundle-biz@example.com');
  await setPlan(biz.business.id, 'business', biz.user.id);
  await receive(biz.cookie, biz.business.id, biz.product.id, biz.location.id, 5);
  const allowed = await move(biz.cookie, biz.business.id, {
    product_id: biz.product.id,
    location_id: biz.location.id,
    type: 'consume',
    quantity: 1,
  });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.json.next, 4);
});

test('movements page with a cursor: no silent 100-row cap', async () => {
  const { cookie, business, location, product } = await setup('mv-page@example.com');
  for (let i = 0; i < 5; i += 1) {
    await receive(cookie, business.id, product.id, location.id, 1);
  }
  const first = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id }, sort: '-created_date', limit: 2 },
    cookie,
  });
  assert.equal(first.json.items.length, 2);
  assert.ok(first.json.next_cursor, 'a cursor is returned while rows remain');
  const second = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id }, sort: '-created_date', limit: 2, cursor: first.json.next_cursor },
    cookie,
  });
  assert.equal(second.json.items.length, 2);
  const third = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id }, sort: '-created_date', limit: 2, cursor: second.json.next_cursor },
    cookie,
  });
  assert.equal(third.json.items.length, 1);
  assert.equal(third.json.next_cursor, null);
});
