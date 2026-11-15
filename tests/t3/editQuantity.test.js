/**
 * T3 — Quantity on hand in the EDIT product form (owner ruling,
 * Nov 14, 2026). The Edit form's quantity box is prefilled with the
 * current count at the chosen location; saving a changed count
 * writes the difference as ONE real ledger movement through the
 * same pair of writes src/lib/inventory.js recordMovement makes
 * (the StockLevel plus the StockMovement row): an increase is a
 * 'receive' of the difference, a decrease is a 'correction' whose
 * quantity IS the typed count (the funnel's set-direction lands
 * the level exactly on it), and an unchanged count writes nothing
 * at all — the typed number never silently overwrites stock.
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

async function seedLevel(cookie, business, product, location, quantity) {
  const res = await req('/api/entities/StockLevel', {
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
  assert.equal(res.status, 201, res.text);
  return res.json;
}

/** The recordMovement pair, exactly as the Edit form's save sends it. */
async function applyEditQuantity(cookie, business, product, location, levelRow, current, typed) {
  if (typed === current) return null;
  const up = typed > current;
  const set = await req(`/api/entities/StockLevel/${levelRow.id}`, {
    method: 'PATCH',
    body: { quantity: typed },
    cookie,
  });
  assert.equal(set.status, 200, set.text);
  const movement = await req('/api/entities/StockMovement', {
    method: 'POST',
    body: {
      business_id: business.id,
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      location_id: location.id,
      location_name: location.name,
      quantity: up ? typed - current : typed,
      previous_qty: current,
      new_qty: typed,
      type: up ? 'receive' : 'correction',
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

test('quantity up: one receive movement of the difference, level lands on the typed count', async () => {
  const owner = await ownerWithBusiness('t3-editqty-up@example.com');
  const main = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Red Bull 16oz', sku: 'RB-1', price: 4.99 },
  ]);
  const level = await seedLevel(owner.cookie, owner.business, product, main, 5);

  const movement = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 5, 9);
  assert.equal(movement.type, 'receive');
  assert.equal(Number(movement.quantity), 4);
  assert.equal(Number(movement.previous_qty), 5);
  assert.equal(Number(movement.new_qty), 9);

  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].quantity), 9);
  const ledger = await movements(owner.cookie, owner.business.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].type, 'receive');
});

test('quantity down: one correction movement landing exactly on the typed count', async () => {
  const owner = await ownerWithBusiness('t3-editqty-down@example.com');
  const main = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Notebook', sku: 'NB-1', price: 9 },
  ]);
  const level = await seedLevel(owner.cookie, owner.business, product, main, 5);

  const movement = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 5, 2);
  assert.equal(movement.type, 'correction');
  assert.equal(Number(movement.quantity), 2);
  assert.equal(Number(movement.previous_qty), 5);
  assert.equal(Number(movement.new_qty), 2);

  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(Number(rows[0].quantity), 2);
  const ledger = await movements(owner.cookie, owner.business.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].type, 'correction');
});

test('quantity down to zero: a correction may land on zero, never below', async () => {
  const owner = await ownerWithBusiness('t3-editqty-zero@example.com');
  const main = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Last Jar', sku: 'JAR-1', price: 4 },
  ]);
  const level = await seedLevel(owner.cookie, owner.business, product, main, 3);

  const movement = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 3, 0);
  assert.equal(movement.type, 'correction');
  assert.equal(Number(movement.new_qty), 0);
  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(Number(rows[0].quantity), 0);
});

test('quantity unchanged: no movement is written and the level is untouched', async () => {
  const owner = await ownerWithBusiness('t3-editqty-same@example.com');
  const main = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Steady Mug', sku: 'MUG-1', price: 11 },
  ]);
  const level = await seedLevel(owner.cookie, owner.business, product, main, 5);

  const movement = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 5, 5);
  assert.equal(movement, null);
  assert.deepEqual(await movements(owner.cookie, owner.business.id), []);
  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(Number(rows[0].quantity), 5);
});

test('Business plan: the same edit-quantity honesty — receive up, correction down, one movement each', async () => {
  // The quantity box is a shared surface: the movement rules are
  // pinned under a Business workspace as well as Essentials (owner
  // requirement, Nov 14, 2026: fixes land on both plans).
  const owner = await ownerWithBusiness('t3-editqty-biz@example.com', 'Biz Qty Shop', { plan: 'business' });
  const main = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Ibuprofen 100ct', sku: 'IBU-1', price: 6.49 },
  ]);
  const level = await seedLevel(owner.cookie, owner.business, product, main, 5);

  const upMove = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 5, 9);
  assert.equal(upMove.type, 'receive');
  assert.equal(Number(upMove.quantity), 4);
  const downMove = await applyEditQuantity(owner.cookie, owner.business, product, main, level, 9, 2);
  assert.equal(downMove.type, 'correction');
  assert.equal(Number(downMove.quantity), 2);
  assert.equal(Number(downMove.previous_qty), 9);
  assert.equal(Number(downMove.new_qty), 2);

  const rows = await levels(owner.cookie, owner.business.id);
  assert.equal(Number(rows[0].quantity), 2);
  const ledger = await movements(owner.cookie, owner.business.id);
  assert.equal(ledger.length, 2);
});
