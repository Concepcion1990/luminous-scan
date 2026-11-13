/**
 * T3 scanner — inventory scanning in/out through the movements
 * endpoint, adding UPC/SKU codes to a product, and structured
 * codes (inventory://). Real Express app over HTTP against pg-mem.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createLocation,
  createProducts,
  receive,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email) {
  const owner = await ownerWithBusiness(email);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Main store' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Bookmark', sku: 'BM-1', upc: '001234567890', price: 9 },
  ]);
  return { ...owner, location, product };
}

test('scan in: scanning a UPC and receiving adds stock', async () => {
  const { cookie, business, location, product } = await setup('scan-in@example.com');
  const lookup = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '001234567890' },
    cookie,
  });
  assert.equal(lookup.json.products[0].id, product.id);
  const received = await receive(cookie, business.id, product.id, location.id, 6);
  assert.equal(received.next, 6);
});

test('scan out: scanning the same UPC and selling removes stock', async () => {
  const { cookie, business, location, product } = await setup('scan-out@example.com');
  await receive(cookie, business.id, product.id, location.id, 6);
  const lookup = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '001234567890' },
    cookie,
  });
  assert.equal(lookup.json.products[0].id, product.id);
  const sold = await req(`/api/businesses/${business.id}/movements`, {
    method: 'POST',
    body: { product_id: product.id, location_id: location.id, type: 'sale', quantity: 2 },
    cookie,
  });
  assert.equal(sold.json.next, 4);
});

test('adding a UPC to a product makes it findable by that code', async () => {
  const { cookie, business } = await setup('scan-add-code@example.com');
  const [coded] = await createProducts(cookie, business.id, [{ name: 'Uncoded', sku: 'UNC-1' }]);
  const before = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '555555555555' },
    cookie,
  });
  assert.equal(before.json.products.length, 0);
  const updated = await req(`/api/entities/Product/${coded.id}`, {
    method: 'PATCH',
    body: { upc: '555555555555' },
    cookie,
  });
  assert.equal(updated.json.upc, '555555555555');
  const after = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '555555555555' },
    cookie,
  });
  assert.equal(after.json.products[0].id, coded.id);
});

test('a structured JSON code classifies and names the product', async () => {
  const { cookie, business } = await setup('scan-structured@example.com');
  const res = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '{"sku":"BM-1","qty":3}' },
    cookie,
  });
  assert.equal(res.json.classification.kind, 'structured');
  assert.equal(res.json.classification.identifier, 'BM-1');
  assert.deepEqual(res.json.classification.fields, [
    { key: 'sku', value: 'BM-1' },
    { key: 'qty', value: '3' },
  ]);
  assert.equal(res.json.products[0].sku, 'BM-1');
});

test('an unknown code offers nothing and the GET lookup matches the POST', async () => {
  const { cookie, business } = await setup('scan-unknown@example.com');
  const post = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'ZZZ-000' },
    cookie,
  });
  assert.equal(post.json.products.length, 0);
  assert.equal(post.json.classification.kind, 'identifier');
  const get = await req(`/api/businesses/${business.id}/scan/lookup?code=${encodeURIComponent('ZZZ-000')}`, {
    method: 'GET',
    cookie,
  });
  assert.deepEqual(get.json.classification, post.json.classification);
});
