/**
 * T3 — Starting quantity on product create (Nov 14, 2026). The
 * product form's create mode stocks the entered quantity through
 * the app's movement funnel (the exact pair of writes
 * src/lib/inventory.js recordMovement makes: the StockLevel plus
 * the StockMovement ledger row, type 'receive', previous 0). These
 * tests prove that pair lands correctly for a fresh product, at
 * the chosen location, and that a blank quantity writes neither.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createLocation,
  seededLocation,
  createProducts,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function levels(cookie, businessId) {
  const res = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  return res.json.items;
}

async function movements(cookie, businessId) {
  const res = await req('/api/entities/StockMovement/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  return res.json.items;
}

/** The recordMovement pair for a fresh product, as the form sends it. */
async function stockOpening(cookie, business, product, location, quantity) {
  const level = await req('/api/entities/StockLevel', {
    method: 'POST',
    body: {
      business_id: business.id,
      product_id: product.id,
      location_id: location.id,
      quantity,
      reserved: 0,
    },
    cookie,
  });
  assert.equal(level.status, 201, level.text);
  const movement = await req('/api/entities/StockMovement', {
    method: 'POST',
    body: {
      business_id: business.id,
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      location_id: location.id,
      location_name: location.name,
      quantity,
      previous_qty: 0,
      new_qty: quantity,
      type: 'receive',
      scanned_code: '',
      note: '',
      reference: '',
      supplier_name: '',
      unit_cost: 0,
      user_name: 'Owner',
    },
    cookie,
  });
  assert.equal(movement.status, 201, movement.text);
  return movement.json;
}

test('create with a starting quantity: level and receive movement land at the chosen location', async () => {
  // Business, so the shop may hold two sites and the choice is real.
  const owner = await ownerWithBusiness('t3-qty@example.com', 'Test Shop', { plan: 'business' });
  const main = await seededLocation(owner.cookie, owner.business.id);
  const back = await createLocation(owner.cookie, owner.business.id, { name: 'Back room' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Candle', sku: 'CND-1', price: 12 },
  ]);
  const movement = await stockOpening(owner.cookie, owner.business, product, back, 7);
  assert.equal(movement.type, 'receive');
  assert.equal(Number(movement.new_qty), 7);
  assert.equal(Number(movement.previous_qty), 0);

  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].location_id, back.id);
  assert.equal(Number(rows[0].quantity), 7);
  assert.notEqual(rows[0].location_id, main.id);

  const ledger = await movements(owner.cookie, owner.business.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].type, 'receive');
  assert.equal(ledger[0].product_id, product.id);
});

test('blank quantity: the product starts at zero — no level, no movement', async () => {
  const owner = await ownerWithBusiness('t3-qty-blank@example.com');
  await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Empty Jar', sku: 'JAR-0', price: 4 },
  ]);
  assert.ok(product.id);
  assert.deepEqual(await levels(owner.cookie, owner.business.id), []);
  assert.deepEqual(await movements(owner.cookie, owner.business.id), []);
});
