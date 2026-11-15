/**
 * Archived products are FROZEN (owner ruling, Nov 14, 2026): while
 * a product is archived, no stock movement of any kind may touch
 * it — not through the movements endpoint, not through the entity
 * layer the client writes through, and not through a reversal.
 * Restoring it to active unfreezes it instantly. Real Express app
 * over HTTP against pg-mem, same shape as movements.test.js.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  seededLocation,
  createProducts,
  receive,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email) {
  const owner = await ownerWithBusiness(email);
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Freezy Pop', sku: 'FZ-1', price: 4.99, cost: 1, reorder_point: 2 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 10);
  return { ...owner, location, product };
}

async function setStatus(cookie, businessId, productId, status) {
  return req(`/api/entities/Product/${productId}`, {
    method: 'PATCH',
    body: { status },
    cookie,
  });
}

async function move(cookie, businessId, body) {
  return req(`/api/businesses/${businessId}/movements`, { method: 'POST', body, cookie });
}

async function levels(cookie, businessId) {
  const res = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  return res.json.items;
}

test('a movement against an archived product is refused and writes nothing', async () => {
  const { cookie, business, location, product } = await setup('freeze-move@example.com');
  const archived = await setStatus(cookie, business.id, product.id, 'archived');
  assert.equal(archived.status, 200);

  const refused = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'receive',
    quantity: 5,
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, 'product_archived');
  assert.match(refused.json.message, /Restore it to active/);

  const rows = await levels(cookie, business.id);
  assert.equal(Number(rows[0].quantity), 10);
});

test('the entity layer refuses StockLevel and StockMovement writes for an archived product', async () => {
  const { cookie, business, location, product } = await setup('freeze-entity@example.com');
  await setStatus(cookie, business.id, product.id, 'archived');

  const levelWrite = await req('/api/entities/StockLevel', {
    method: 'POST',
    body: { business_id: business.id, product_id: product.id, location_id: location.id, quantity: 3 },
    cookie,
  });
  assert.equal(levelWrite.status, 400);
  assert.equal(levelWrite.json.error, 'product_archived');

  const movementWrite = await req('/api/entities/StockMovement', {
    method: 'POST',
    body: {
      business_id: business.id,
      product_id: product.id,
      location_id: location.id,
      type: 'receive',
      quantity: 3,
    },
    cookie,
  });
  assert.equal(movementWrite.status, 400);
  assert.equal(movementWrite.json.error, 'product_archived');
});

test('reversing a movement of an archived product answers with the restore-first door', async () => {
  const { cookie, business, location, product } = await setup('freeze-reverse@example.com');
  const movements = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: business.id, product_id: product.id } },
    cookie,
  });
  const movementId = movements.json.items[0].id;
  await setStatus(cookie, business.id, product.id, 'archived');

  const refused = await req(`/api/businesses/${business.id}/movements/${movementId}/reverse`, {
    method: 'POST',
    body: {},
    cookie,
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, 'product_archived');
  assert.match(refused.json.message, /Restore it to active first, then reverse/);
});

test('restoring to active unfreezes instantly', async () => {
  const { cookie, business, location, product } = await setup('freeze-restore@example.com');
  await setStatus(cookie, business.id, product.id, 'archived');
  const restored = await setStatus(cookie, business.id, product.id, 'active');
  assert.equal(restored.status, 200);

  const ok = await move(cookie, business.id, {
    product_id: product.id,
    location_id: location.id,
    type: 'receive',
    quantity: 2,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.next, 12);
});
