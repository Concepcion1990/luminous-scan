/**
 * T3 — Stock-door movement semantics + the unlimited-quantity
 * ruling (Nov 14, 2026). The Products-page stepper writes, per
 * tap, the movement pair the shared funnel writes (level +
 * ledger row): up = receive +1, down = correction setting the
 * count one lower. And quantity per item is UNLIMITED — the
 * Essentials cap counts PRODUCTS (50), never units: receiving a
 * hundred thousand of one product succeeds and the math stays
 * exact.
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
  receive,
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

/** One stepper tap, written the way recordMovement writes it. */
async function tap(cookie, business, product, location, type, quantity, previousQty, newQty) {
  const existing = (await levels(cookie, business.id)).find(
    (l) => l.product_id === product.id && l.location_id === location.id,
  );
  if (existing) {
    const res = await req(`/api/entities/StockLevel/${existing.id}`, {
      method: 'PATCH',
      body: { quantity: newQty },
      cookie,
    });
    assert.equal(res.status, 200, res.text);
  } else {
    const res = await req('/api/entities/StockLevel', {
      method: 'POST',
      body: { business_id: business.id, product_id: product.id, location_id: location.id, quantity: newQty, reserved: 0 },
      cookie,
    });
    assert.equal(res.status, 201, res.text);
  }
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
      previous_qty: previousQty,
      new_qty: newQty,
      type,
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
}

test('stepper taps: receive +1 raises the count, correction lowers it by one, ledger shows both', async () => {
  const owner = await ownerWithBusiness('t3-stepper@example.com');
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Mug', sku: 'MUG-1', price: 8 },
  ]);

  await tap(owner.cookie, owner.business, product, location, 'receive', 1, 0, 1);
  await tap(owner.cookie, owner.business, product, location, 'receive', 1, 1, 2);
  await tap(owner.cookie, owner.business, product, location, 'correction', 1, 2, 1);

  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].quantity), 1);

  const ledger = await movements(owner.cookie, owner.business.id);
  assert.equal(ledger.length, 3);
  const types = ledger.map((m) => m.type).sort();
  assert.deepEqual(types, ['correction', 'receive', 'receive']);
  const correction = ledger.find((m) => m.type === 'correction');
  assert.equal(Number(correction.previous_qty), 2);
  assert.equal(Number(correction.new_qty), 1);
});

test('quantity per item is unlimited: receiving 100,000 units succeeds and the count stays exact', async () => {
  const owner = await ownerWithBusiness('t3-qty-unlimited@example.com');
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Bulk Beads', sku: 'BEAD-1', price: 1, cost: 0.5 },
  ]);
  const first = await receive(owner.cookie, owner.business.id, product.id, location.id, 100000);
  assert.equal(first.next, 100000);
  const second = await receive(owner.cookie, owner.business.id, product.id, location.id, 100000);
  assert.equal(second.next, 200000);
  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(Number(rows[0].quantity), 200000);
});
