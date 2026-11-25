/**
 * T28 — Carrier shipping-label records (Scope A, Nov 14, 2026).
 *
 * The owner's design, pinned:
 *  - A carrier-bought label file (PDF/PNG/JPG) stores against ONE
 *    customer order, permanently, as the business's private record.
 *  - Both plans: the routes carry NO plan gate (uploading a record is
 *    not a Business feature).
 *  - The bytes are served back byte-for-byte, only to members of the
 *    owning business, through an authenticated route — never a public
 *    URL (unlike product photos, which are public by design).
 *  - Replace overwrites the one record; remove deletes it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  close, req, reqRaw, ownerWithBusiness, setPlan, registerVerifiedUser,
} from './helpers.js';

after(close);

let seq = 0;
async function ownerWithOrder(plan = 'essentials') {
  seq += 1;
  const owner = await ownerWithBusiness(`t28-labels-${seq}@example.com`, 'Label Shop', { plan });
  const res = await req('/api/entities/Order', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      number: `ORD-T28-${seq}`,
      customer_name: 'Jamie Rivera',
      lines: [],
      total: 0,
    },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 201, res.text);
  return { owner, order: res.json };
}

const PDF_BYTES = Buffer.from('%PDF-1.4 fake carrier label bytes 0123456789');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;
const labelPath = (b, o) => `/api/businesses/${b}/orders/${o}/shipping-label`;

test('carrier label: upload a PDF, read its metadata, download the exact bytes back', async () => {
  const { owner, order } = await ownerWithOrder('essentials');
  const up = await req(labelPath(owner.business.id, order.id), {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: 'ups-label.pdf' },
    cookie: owner.cookie,
  });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.exists, true);
  assert.equal(up.json.content_type, 'application/pdf');
  assert.equal(up.json.filename, 'ups-label.pdf');
  assert.equal(up.json.size_bytes, PDF_BYTES.length);
  assert.ok(up.json.updated_at, 'the record carries its save time');

  const meta = await req(labelPath(owner.business.id, order.id), { cookie: owner.cookie });
  assert.equal(meta.status, 200, meta.text);
  assert.equal(meta.json.exists, true);
  assert.equal(meta.json.filename, 'ups-label.pdf');

  const file = await reqRaw(`${labelPath(owner.business.id, order.id)}/file`, { cookie: owner.cookie });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(file.buffer, PDF_BYTES, 'the stored bytes come back byte-for-byte');
});

test('carrier label: PNG and JPG uploads work too, on Business as well', async () => {
  const { owner, order } = await ownerWithOrder('business');
  const up = await req(labelPath(owner.business.id, order.id), {
    method: 'POST',
    body: { dataUrl: dataUrl('image/png', PNG_BYTES), filename: 'label.png' },
    cookie: owner.cookie,
  });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.content_type, 'image/png');
  const file = await reqRaw(`${labelPath(owner.business.id, order.id)}/file`, { cookie: owner.cookie });
  assert.deepEqual(file.buffer, PNG_BYTES);
});

test('carrier label: replace overwrites the one record; remove deletes it', async () => {
  const { owner, order } = await ownerWithOrder('essentials');
  const path = labelPath(owner.business.id, order.id);
  await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: 'first.pdf' },
    cookie: owner.cookie,
  });
  const second = await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('image/png', PNG_BYTES), filename: 'second.png' },
    cookie: owner.cookie,
  });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.json.filename, 'second.png');
  const file = await reqRaw(`${path}/file`, { cookie: owner.cookie });
  assert.deepEqual(file.buffer, PNG_BYTES, 'the replacement is what downloads');

  const del = await req(path, { method: 'DELETE', cookie: owner.cookie });
  assert.equal(del.status, 200, del.text);
  const meta = await req(path, { cookie: owner.cookie });
  assert.deepEqual(meta.json, { exists: false });
  const gone = await reqRaw(`${path}/file`, { cookie: owner.cookie });
  assert.equal(gone.status, 404);
});

test('carrier label: bad types and oversize files are refused, nothing stored', async () => {
  const { owner, order } = await ownerWithOrder('essentials');
  const path = labelPath(owner.business.id, order.id);
  const badType = await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('text/plain', Buffer.from('hello')), filename: 'x.txt' },
    cookie: owner.cookie,
  });
  assert.equal(badType.status, 400);
  assert.equal(badType.json.error, 'invalid_label');

  const big = Buffer.alloc(25 * 1024 * 1024 + 16, 7);
  const tooBig = await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', big), filename: 'big.pdf' },
    cookie: owner.cookie,
  });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.error, 'invalid_label');

  const meta = await req(path, { cookie: owner.cookie });
  assert.deepEqual(meta.json, { exists: false }, 'refused uploads leave no record');
});

test('carrier label: only the owning business can see or touch a record', async () => {
  const { owner, order } = await ownerWithOrder('essentials');
  const path = labelPath(owner.business.id, order.id);
  await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: 'mine.pdf' },
    cookie: owner.cookie,
  });

  // A stranger with their own account and business: 403 everywhere.
  const stranger = await ownerWithBusiness('t28-stranger@example.com', 'Other Shop', { plan: 'business' });
  const sMeta = await req(path, { cookie: stranger.cookie });
  assert.equal(sMeta.status, 403);
  const sFile = await reqRaw(`${path}/file`, { cookie: stranger.cookie });
  assert.equal(sFile.status, 403);
  const sUp = await req(path, {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: 'evil.pdf' },
    cookie: stranger.cookie,
  });
  assert.equal(sUp.status, 403);

  // No session at all: 401.
  const anon = await req(path, {});
  assert.equal(anon.status, 401);

  // An order id from ANOTHER business under the owner's own business
  // path: 404 — the record is scoped to the order's own business.
  const other = await ownerWithOrder('essentials');
  const cross = await req(labelPath(owner.business.id, other.order.id), { cookie: owner.cookie });
  assert.equal(cross.status, 404);
  const crossUp = await req(labelPath(owner.business.id, other.order.id), {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: 'x.pdf' },
    cookie: owner.cookie,
  });
  assert.equal(crossUp.status, 404);
});

test('carrier label: filenames are cleaned (no paths, no quotes) before storage', async () => {
  const { owner, order } = await ownerWithOrder('essentials');
  const up = await req(labelPath(owner.business.id, order.id), {
    method: 'POST',
    body: { dataUrl: dataUrl('application/pdf', PDF_BYTES), filename: '../../evil "label".pdf' },
    cookie: owner.cookie,
  });
  assert.equal(up.status, 201, up.text);
  assert.ok(!up.json.filename.includes('/'), 'no path survives');
  assert.ok(!up.json.filename.includes('"'), 'no quote survives');
});
