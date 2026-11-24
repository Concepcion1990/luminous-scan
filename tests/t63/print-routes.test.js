/**
 * Print family — the HTTP proof (Nov 24, 2026): the labels PDF
 * route, exercised end to end against the real server.
 *
 *   - A product whose stored photo lives in product_photos gets
 *     that photo embedded in its downloaded label (the route
 *     resolves photo_urls[0] → the stored bytes → the PDF).
 *   - 60 selected products print 60 labels (8 pages) — the old
 *     route silently sliced the selection at 50 (7 pages), which
 *     is exactly the owner's screenshot: she selected 100 and
 *     the PDF held 50.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, reqRaw, close, ownerWithBusiness, createProducts } from '../t3/helpers.js';

after(close);

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM/////w8AH+4F+7C4l8kAAAAASUVORK5CYII=';

const pageCount = (buffer) => Number(buffer.toString('latin1').match(/\/Count (\d+)/)?.[1] || 0);

test('labels route: the stored photo embeds, and 60 selected print as 60 labels', async () => {
  // Business for the test catalog only: 60 products exceed the
  // Essentials 50-product plan cap. Labels themselves print on
  // both plans (proven in t5); nothing here is plan-gated.
  const owner = await ownerWithBusiness('printfamily@example.com', 'Test Shop', { plan: 'business' });
  const businessId = owner.business.id;

  const created = await createProducts(
    owner.cookie,
    businessId,
    Array.from({ length: 60 }, (_, i) => ({
      name: `Print Book ${i + 1}`,
      sku: `PB-${i + 1}`,
      price: 5,
      barcode: '123456789012',
    })),
  );
  assert.equal(created.length, 60);

  // Give the first product a stored photo, the way the photo
  // door leaves it: bytes in product_photos, named by photo_urls.
  const photoId = 'print-family-photo-1';
  await pool.query(
    'INSERT INTO product_photos (id, business_id, content_type, size_bytes, data_base64) VALUES ($1, $2, $3, $4, $5)',
    [photoId, businessId, 'image/png', Buffer.from(PNG_BASE64, 'base64').length, PNG_BASE64],
  );
  await pool.query('UPDATE products SET photo_urls = $2 WHERE id = $1', [
    created[0].id,
    JSON.stringify([`/api/photos/${photoId}`]),
  ]);

  const one = await reqRaw(
    `/api/businesses/${businessId}/print/labels?product_ids=${created[0].id}&copies=1`,
    { cookie: owner.cookie },
  );
  assert.equal(one.status, 200);
  assert.ok(one.buffer.toString('latin1').startsWith('%PDF-'));
  assert.ok(
    one.buffer.toString('latin1').includes('/Subtype /Image'),
    'the label PDF embeds the stored photo',
  );

  const plain = await reqRaw(
    `/api/businesses/${businessId}/print/labels?product_ids=${created[1].id}&copies=1`,
    { cookie: owner.cookie },
  );
  assert.equal(plain.status, 200);
  assert.ok(
    !plain.buffer.toString('latin1').includes('/Subtype /Image'),
    'a photo-less product prints the plain label it always did',
  );

  const ids = created.map((p) => p.id).join(',');
  const all = await reqRaw(`/api/businesses/${businessId}/print/labels?product_ids=${ids}&copies=1`, {
    cookie: owner.cookie,
  });
  assert.equal(all.status, 200);
  assert.equal(pageCount(all.buffer), 8, '60 labels at 8 per page — nothing sliced at 50');
});
