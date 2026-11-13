/**
 * T3 products — CRUD, the Essentials 50-product cap (server-side),
 * archive freeing a slot, cross-business isolation, and the scan
 * lookup path. Real Express app over HTTP against pg-mem.
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
  createProducts,
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

function product(i, overrides = {}) {
  return { name: `Product ${i}`, sku: `SKU-${String(i).padStart(3, '0')}`, price: 9.99, ...overrides };
}

test('products CRUD: create, read, update, archive, delete', async () => {
  const { cookie, business } = await ownerWithBusiness('crud@example.com');
  const [created] = await createProducts(cookie, business.id, [product(1, { name: 'Bookmark' })]);
  assert.equal(created.name, 'Bookmark');
  assert.equal(created.sku, 'SKU-001');
  assert.equal(created.status, 'active');
  assert.ok(created.id);

  const listed = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: business.id }, sort: 'name' },
    cookie,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.items.length, 1);
  assert.equal(listed.json.items[0].name, 'Bookmark');

  const updated = await req(`/api/entities/Product/${created.id}`, {
    method: 'PATCH',
    body: { price: 12.5 },
    cookie,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.price, 12.5);

  const archived = await req(`/api/entities/Product/${created.id}`, {
    method: 'PATCH',
    body: { status: 'archived' },
    cookie,
  });
  assert.equal(archived.json.status, 'archived');

  const deleted = await req(`/api/entities/Product/${created.id}`, { method: 'DELETE', cookie });
  assert.equal(deleted.status, 200);
  const gone = await req(`/api/entities/Product/${created.id}`, { method: 'GET', cookie });
  assert.equal(gone.status, 404);
});

test('Essentials cap: the 51st active product is refused server-side (403 product_limit)', async () => {
  const { cookie, business } = await ownerWithBusiness('cap50@example.com');
  const fifty = Array.from({ length: 50 }, (_, i) => product(i + 1));
  const created = await createProducts(cookie, business.id, fifty.slice(0, 50));
  assert.equal(created.length, 50);

  const over = await req(`/api/businesses/${business.id}/products`, {
    method: 'POST',
    body: { business_id: business.id, products: [product(51)] },
    cookie,
  });
  assert.equal(over.status, 403);
  assert.equal(over.json.error, 'product_limit');
  assert.equal(over.json.limit, 50);
  assert.equal(over.json.used, 50);

  // The direct entity create path is guarded too (copy/duplicate path).
  const direct = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: business.id, ...product(52) },
    cookie,
  });
  assert.equal(direct.status, 403);
  assert.equal(direct.json.error, 'product_limit');
});

test('archiving frees a slot: 50 active + 1 archived, then a new product fits', async () => {
  const { cookie, business } = await ownerWithBusiness('cap-free@example.com');
  const created = await createProducts(cookie, business.id, Array.from({ length: 50 }, (_, i) => product(i + 1)));
  await req(`/api/entities/Product/${created[0].id}`, {
    method: 'PATCH',
    body: { status: 'archived' },
    cookie,
  });
  const oneMore = await createProducts(cookie, business.id, [product(51)]);
  assert.equal(oneMore.length, 1);
  const count = await req('/api/entities/Product/count', {
    method: 'POST',
    body: { filter: { business_id: business.id, status: { $ne: 'archived' } } },
    cookie,
  });
  assert.equal(count.json.count, 50);
});

test('Business plan has no product cap', async () => {
  const { cookie, business, user } = await ownerWithBusiness('biz-nocap@example.com');
  await setPlan(business.id, 'business', user.id);
  const created = await createProducts(cookie, business.id, Array.from({ length: 55 }, (_, i) => product(i + 1)));
  assert.equal(created.length, 55);
});

test('products are isolated per business and per user', async () => {
  const first = await ownerWithBusiness('iso-a@example.com', 'Shop A');
  const second = await ownerWithBusiness('iso-b@example.com', 'Shop B');
  await createProducts(first.cookie, first.business.id, [product(1, { name: 'Only in A' })]);

  // Shop B sees none of Shop A's catalog.
  const inB = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: second.business.id } },
    cookie: second.cookie,
  });
  assert.equal(inB.json.items.length, 0);

  // Shop B's owner cannot read Shop A's business at all.
  const cross = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: first.business.id } },
    cookie: second.cookie,
  });
  assert.equal(cross.json.items.length, 0);

  // Signed out: 401.
  const anon = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: first.business.id } },
  });
  assert.equal(anon.status, 401);
});

test('product create requires a name and a business', async () => {
  const { cookie, business } = await ownerWithBusiness('valid@example.com');
  const noName = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: business.id, sku: 'X-1' },
    cookie,
  });
  assert.equal(noName.status, 400);
  const noBusiness = await req('/api/entities/Product', {
    method: 'POST',
    body: { name: 'No home' },
    cookie,
  });
  assert.equal(noBusiness.status, 400);
});

test('entitlement read: missing row resolves to Essentials, Business row reads back', async () => {
  const { cookie, business, user } = await ownerWithBusiness('ent-read@example.com', 'Test Shop', { grant: false });
  const before = await req(`/api/businesses/${business.id}/entitlement`, { method: 'GET', cookie });
  assert.equal(before.json.plan, 'essentials');
  assert.equal(before.json.entitlement, null);
  await setPlan(business.id, 'business', user.id);
  const after = await req(`/api/businesses/${business.id}/entitlement`, { method: 'GET', cookie });
  assert.equal(after.json.plan, 'business');
  assert.equal(after.json.entitlement.plan, 'business');
});

test('scan lookup finds products by SKU, UPC, ISBN and loose separators', async () => {
  const { cookie, business } = await ownerWithBusiness('scan-lookup@example.com');
  await createProducts(cookie, business.id, [
    { name: 'Spaced SKU', sku: 'TEST - PJ - 001', price: 5 },
    { name: 'ISBN book', isbn: '9780143127741', price: 12 },
    { name: 'UPC item', upc: '001234567890', price: 3 },
  ]);
  const bySku = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'TEST-PJ-001' },
    cookie,
  });
  assert.equal(bySku.status, 200);
  assert.equal(bySku.json.products.length, 1);
  assert.equal(bySku.json.products[0].name, 'Spaced SKU');
  assert.equal(bySku.json.classification.kind, 'identifier');

  const byIsbn = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: '9780143127741' },
    cookie,
  });
  assert.equal(byIsbn.json.products[0].name, 'ISBN book');

  const miss = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'NOPE-000' },
    cookie,
  });
  assert.equal(miss.json.products.length, 0);
});

test('scan lookup classifies a website QR as a URL to open, not inventory', async () => {
  const { cookie, business } = await ownerWithBusiness('scan-url@example.com');
  const res = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'https://theluminousbookshop.com/products/blue-mug-123' },
    cookie,
  });
  assert.equal(res.json.classification.kind, 'url');
  assert.equal(res.json.classification.url, 'https://theluminousbookshop.com/products/blue-mug-123');
  assert.equal(res.json.products.length, 0);
  // A bare domain is a URL too; a javascript: link is not.
  const domain = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'example.com/shop' },
    cookie,
  });
  assert.equal(domain.json.classification.kind, 'url');
  const unsafe = await req(`/api/businesses/${business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'javascript:alert(1)' },
    cookie,
  });
  assert.equal(unsafe.json.classification.kind, 'text');
  assert.equal(unsafe.json.classification.unsafeLink, true);
});

test('a second business needs the Business plan (oldest workspace decides)', async () => {
  const owner = await registerVerifiedUser('twobiz@example.com');
  const first = await createBusiness(owner.cookie, 'First shop');
  const secondAttempt = await req('/api/businesses', {
    method: 'POST',
    body: { name: 'Second shop' },
    cookie: owner.cookie,
  });
  assert.equal(secondAttempt.status, 403);
  assert.equal(secondAttempt.json.error, 'business_limit_reached');
  await setPlan(first.id, 'business', owner.user.id);
  const second = await createBusiness(owner.cookie, 'Second shop');
  assert.equal(second.name, 'Second shop');
});
