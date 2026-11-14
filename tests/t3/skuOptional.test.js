/**
 * T3 — SKU is optional on product create (Nov 14, 2026). The owner
 * created a product from a barcode scan — name + UPC filled by the
 * scan, SKU blank — and Create refused with a message that also
 * falsely claimed the name was missing. Now: a blank SKU is
 * generated server-side with the spreadsheet import's own scheme
 * (name slug, ITEM-<n> fallback, -2/-3… until unique per business),
 * stored on the product where the owner can see and edit it; a
 * TYPED sku keeps the catalog's uniqueness rule. The import layer
 * is untouched (its own duplicate/blank handling already existed).
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

function createProduct(cookie, businessId, fields) {
  return req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: businessId, status: 'active', ...fields },
    cookie,
  });
}

test('create with a blank SKU succeeds and the product carries a generated SKU from its name', async () => {
  const owner = await ownerWithBusiness('t3-sku-blank@example.com');
  const created = await createProduct(owner.cookie, owner.business.id, { name: 'Blue Mug' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.sku, 'BLUE-MUG');
});

test('two blank-SKU creates of the same name get different SKUs', async () => {
  const owner = await ownerWithBusiness('t3-sku-twice@example.com');
  const first = await createProduct(owner.cookie, owner.business.id, { name: 'Blue Mug' });
  const second = await createProduct(owner.cookie, owner.business.id, { name: 'Blue Mug' });
  assert.equal(first.status, 201, first.text);
  assert.equal(second.status, 201, second.text);
  assert.equal(first.json.sku, 'BLUE-MUG');
  assert.equal(second.json.sku, 'BLUE-MUG-2');
  assert.notEqual(first.json.sku, second.json.sku);
});

test('the scan-create shape (UPC + barcode seeded, no SKU) succeeds end to end', async () => {
  const owner = await ownerWithBusiness('t3-sku-scan@example.com');
  const created = await createProduct(owner.cookie, owner.business.id, {
    name: 'Scanned Notebook',
    upc: '012345678905',
    barcode: '012345678905',
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.sku, 'SCANNED-NOTEBOOK');
  assert.equal(created.json.upc, '012345678905');
});

test('a typed SKU is kept exactly, and a duplicate typed SKU is refused', async () => {
  const owner = await ownerWithBusiness('t3-sku-typed@example.com');
  const first = await createProduct(owner.cookie, owner.business.id, { name: 'One', sku: 'MY-SKU-1' });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.sku, 'MY-SKU-1');
  const dupe = await createProduct(owner.cookie, owner.business.id, { name: 'Two', sku: 'my-sku-1' });
  assert.equal(dupe.status, 400);
  assert.equal(dupe.json.error, 'sku_already_exists');
});

test('a generated SKU does not collide with a typed one, and another business may reuse the same SKU', async () => {
  const owner = await ownerWithBusiness('t3-sku-scope@example.com');
  const typed = await createProduct(owner.cookie, owner.business.id, { name: 'Typed', sku: 'BLUE-MUG' });
  assert.equal(typed.status, 201, typed.text);
  const generated = await createProduct(owner.cookie, owner.business.id, { name: 'Blue Mug' });
  assert.equal(generated.status, 201, generated.text);
  assert.equal(generated.json.sku, 'BLUE-MUG-2');

  const other = await ownerWithBusiness('t3-sku-other@example.com');
  const reused = await createProduct(other.cookie, other.business.id, { name: 'Blue Mug', sku: 'BLUE-MUG' });
  assert.equal(reused.status, 201, reused.text);
  assert.equal(reused.json.sku, 'BLUE-MUG');
});
