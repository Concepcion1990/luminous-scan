/**
 * T6 — The one counting rule at the server cap (owner, Nov 14,
 * 2026): count = DISTINCT ORIGINAL products, any status. Copies
 * never count; archiving never frees a slot ("then they could add
 * as many products as they can as long as they're archived" — the
 * sieve this closes); only a true delete lowers the count.
 *
 * One Essentials business walks the whole matrix at the 50 cap so
 * the gate the customer hits is the gate these pins describe.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { close, req, ownerWithBusiness, createProducts } from './helpers.js';

after(close);

const product = (i, extra = {}) => ({
  name: `Widget ${i}`,
  sku: `W-${i}`,
  upc: `9000000${String(i).padStart(4, '0')}`,
  price: 1,
  ...extra,
});

test('the unified counting rule at the Essentials cap', async () => {
  const { cookie, business } = await ownerWithBusiness('counting-cap@example.com');
  const created = await createProducts(
    cookie,
    business.id,
    Array.from({ length: 50 }, (_, i) => product(i + 1)),
  );
  assert.equal(created.length, 50);

  const attempt = (rows) => req(`/api/businesses/${business.id}/products`, {
    method: 'POST',
    body: { business_id: business.id, products: rows },
    cookie,
  });

  // Archive 30 of the 50: the count must not move.
  for (const row of created.slice(0, 30)) {
    const res = await req(`/api/entities/Product/${row.id}`, {
      method: 'PATCH',
      body: { status: 'archived' },
      cookie,
    });
    assert.equal(res.status, 200);
  }

  // The 51st distinct original is refused even with 30 archived.
  const over = await attempt([product(51)]);
  assert.equal(over.status, 403);
  assert.equal(over.json.error, 'product_limit');
  assert.equal(over.json.used, 50, 'the gate reports the distinct count, archived included');

  // An original BORN archived consumes a slot too — refused.
  const bornArchived = await attempt([product(52, { status: 'archived' })]);
  assert.equal(bornArchived.status, 403);
  assert.equal(bornArchived.json.error, 'product_limit');

  // Copies never count: a marked copy fits at the cap…
  const [markedCopy] = await createProducts(cookie, business.id, [
    product(1, { name: 'Widget 1 (copy)', sku: 'W-1-COPY', upc: '', barcode: '', qr_code: '', duplicate_of: created[0].id }),
  ]);
  assert.ok(markedCopy.id);
  // …and so does a legacy copy carrying only its birthmarks.
  const [legacyCopy] = await createProducts(cookie, business.id, [
    product(2, { name: 'Widget 2 (copy)', sku: 'W-2-COPY', upc: '', barcode: '', qr_code: '' }),
  ]);
  assert.ok(legacyCopy.id);

  // Restoring an archived original at the cap is fine — it never
  // left the count, so nothing can breach.
  const restore = await req(`/api/entities/Product/${created[0].id}`, {
    method: 'PATCH',
    body: { status: 'active' },
    cookie,
  });
  assert.equal(restore.status, 200);

  // A true delete is the only thing that lowers the count: delete
  // one original and exactly one new distinct product fits.
  const del = await req(`/api/entities/Product/${created[49].id}`, { method: 'DELETE', cookie });
  assert.equal(del.status, 200);
  const [fits] = await createProducts(cookie, business.id, [product(51)]);
  assert.ok(fits.id);
  const overAgain = await attempt([product(53)]);
  assert.equal(overAgain.status, 403);
  assert.equal(overAgain.json.used, 50);
});

test('a bulk batch is charged only for its distinct originals', async () => {
  const { cookie, business } = await ownerWithBusiness('counting-bulk@example.com');
  const created = await createProducts(
    cookie,
    business.id,
    Array.from({ length: 49 }, (_, i) => product(i + 1)),
  );
  assert.equal(created.length, 49);
  // 1 distinct + 3 copies in one batch: only the distinct one is
  // charged, so the batch fits exactly at 50.
  const batch = await createProducts(cookie, business.id, [
    product(50),
    product(1, { name: 'W1 copy', sku: 'W-1-COPY', upc: '', barcode: '', qr_code: '', duplicate_of: created[0].id }),
    product(2, { name: 'W2 copy', sku: 'W-2-COPY', upc: '', barcode: '', qr_code: '' }),
    product(3, { name: 'W3 copy', sku: 'W-3-COPY', upc: '', barcode: '', qr_code: '', duplicate_of: created[2].id }),
  ]);
  assert.equal(batch.length, 4);
  const over = await req(`/api/businesses/${business.id}/products`, {
    method: 'POST',
    body: { business_id: business.id, products: [product(51)] },
    cookie,
  });
  assert.equal(over.status, 403);
  assert.equal(over.json.used, 50);
});
