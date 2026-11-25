/**
 * T6 — Product photos (Nov 14, 2026): the upload path that was a
 * dead Base44 stub is real. Bytes are stored in Postgres
 * (migration 020) and served publicly by unguessable id from
 * /api/photos/:id — the form's own promise ("anyone with the link
 * can open them") — while uploads require business membership and
 * follow the logo's discipline (PNG/JPG/WebP, 25 MB). The 6-per-
 * product cap is enforced where photo_urls are saved.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  req,
  reqRaw,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

// A real 1x1 transparent PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function upload(cookie, businessId, dataUrl = PNG_DATA_URL) {
  return req(`/api/businesses/${businessId}/product-photos`, {
    method: 'POST',
    body: { dataUrl },
    cookie,
  });
}

test('upload returns a public URL that serves the exact image bytes, no session needed', async () => {
  const owner = await ownerWithBusiness('t6-photo@example.com');
  const res = await upload(owner.cookie, owner.business.id);
  assert.equal(res.status, 201, res.text);
  assert.match(res.json.url, /^http:\/\/[^/]+\/api\/photos\/[0-9a-f-]{36}$/);
  const path = new URL(res.json.url).pathname;
  const served = await reqRaw(path); // no cookie — public by design
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(served.buffer, PNG_BYTES);
  const missing = await reqRaw('/api/photos/00000000-0000-0000-0000-000000000000');
  assert.equal(missing.status, 404);
});

test('the URL persists on the product through the entity API, and removal works', async () => {
  const owner = await ownerWithBusiness('t6-photo-product@example.com');
  const up = await upload(owner.cookie, owner.business.id);
  assert.equal(up.status, 201, up.text);
  const created = await req('/api/entities/Product', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      name: 'Photo Book',
      sku: 'PHOTO-1',
      status: 'active',
      photo_urls: [up.json.url],
    },
    cookie: owner.cookie,
  });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(created.json.photo_urls, [up.json.url]);
  const removed = await req(`/api/entities/Product/${created.json.id}`, {
    method: 'PATCH',
    body: { photo_urls: [] },
    cookie: owner.cookie,
  });
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.json.photo_urls, []);
});

test('non-image payloads and oversize images are refused', async () => {
  const owner = await ownerWithBusiness('t6-photo-limits@example.com');
  const text = await upload(owner.cookie, owner.business.id, 'data:text/plain;base64,aGVsbG8=');
  assert.equal(text.status, 400);
  assert.equal(text.json.error, 'invalid_photo');
  const gif = await upload(owner.cookie, owner.business.id, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
  assert.equal(gif.status, 400);
  assert.equal(gif.json.error, 'invalid_photo');
  const big = Buffer.alloc(25 * 1024 * 1024 + 1, 7).toString('base64');
  const oversize = await upload(owner.cookie, owner.business.id, `data:image/png;base64,${big}`);
  assert.equal(oversize.status, 400);
  assert.equal(oversize.json.error, 'invalid_photo');
});

test('membership is required: outsiders and anonymous callers are refused, a staff member may upload', async () => {
  const owner = await ownerWithBusiness('t6-photo-gate@example.com');
  const outsider = await registerVerifiedUser('t6-photo-outsider@example.com');
  const refused = await upload(outsider.cookie, owner.business.id);
  assert.equal(refused.status, 403);
  const anon = await upload(null, owner.business.id);
  assert.equal(anon.status, 401);

  const invite = await req(`/api/businesses/${owner.business.id}/staff`, {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      member: {
        full_name: 'Team Member',
        email: 't6-photo-staff@example.com',
        role_id: 'preset-sales',
        role_name: 'Sales clerk',
        permissions: ['products.view'],
        status: 'invited',
      },
    },
    cookie: owner.cookie,
  });
  assert.equal(invite.status, 201, invite.text);
  const staff = await registerVerifiedUser('t6-photo-staff@example.com');
  const staffUpload = await upload(staff.cookie, owner.business.id);
  assert.equal(staffUpload.status, 201, staffUpload.text);
});

test('the 6-per-product cap is enforced on save', async () => {
  const owner = await ownerWithBusiness('t6-photo-cap@example.com');
  const seven = Array.from({ length: 7 }, (_, i) => `https://example.com/p${i}.png`);
  const created = await req('/api/entities/Product', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      name: 'Too Many Photos',
      sku: 'PHOTO-7',
      status: 'active',
      photo_urls: seven,
    },
    cookie: owner.cookie,
  });
  assert.equal(created.status, 400);
  assert.equal(created.json.error, 'too_many_photos');
});

test('the dead stub is gone: UploadPublicFile is a real implementation and the dialog shows failures at the field', () => {
  const client = readFileSync(new URL('../../src/api/client.js', import.meta.url), 'utf8');
  assert.ok(!client.includes("notImplemented('integrations.Core.UploadPublicFile')"));
  assert.ok(client.includes('/product-photos'), 'client posts to the photo endpoint');
  const dialog = readFileSync(new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url), 'utf8');
  assert.ok(dialog.includes('photoError'), 'the dialog carries a field-level photo error');
  assert.ok(dialog.includes('role="alert"'), 'the field error is announced at the photos field');
});

test('the app sizes photos FOR the customer: resize before upload, and size is never the refusal', () => {
  const prep = readFileSync(new URL('../../src/lib/imagePrep.js', import.meta.url), 'utf8');
  assert.ok(prep.includes('createImageBitmap'), 'decoding honors EXIF orientation');
  assert.ok(prep.includes('MAX_EDGE = 1600'), 'downscale to a 1600px long edge');
  assert.ok(prep.includes('JPEG_QUALITY = 0.85'), 'JPEG re-encode at 0.85');
  const client = readFileSync(new URL('../../src/api/client.js', import.meta.url), 'utf8');
  assert.ok(client.includes('prepareImageForUpload(file)'), 'photo upload prepares the image first');
  const dialog = readFileSync(new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url), 'utf8');
  assert.ok(!dialog.includes('file.size > 2 * 1024 * 1024'), 'the dialog never refuses a photo for its size');
  const settings = readFileSync(new URL('../../src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.ok(settings.includes('prepareImageForUpload(file, { preserveFormat: true })'), 'the logo upload is sized for the owner too, format preserved');
  const en = readFileSync(new URL('../../src/lib/locales/en.js', import.meta.url), 'utf8');
  assert.ok(!/uploadFailed[^\n]*smaller/i.test(en), 'the failure copy never tells the customer to shrink an image');
});
