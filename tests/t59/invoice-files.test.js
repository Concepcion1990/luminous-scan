/**
 * T59b — supplier invoice files (release 361, Nov 23, 2026).
 *
 * Her ruling, universal: anywhere in the app there's an
 * import or a file upload, the limit is 25 MB, both plans.
 * The invoice's paper copy is 361's own upload door and is
 * born at that cap. These tests pin the constant on both
 * sides of the wire, the round trip, replace semantics, the
 * oversize + wrong-type refusals, the tick gate on writes
 * with the free view base on reads, the Business gate, and
 * the cross-business 404.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  createProducts,
} from './helpers.js';
import { INVOICE_FILE_MAX_BYTES } from '../../server/restaurantFileRoutes.js';

let seq = 0;
const email = (label) => `${label}${++seq}@example.com`;

async function createEntity(cookie, name, body) {
  return req(`/api/entities/${name}`, { method: 'POST', cookie, body });
}

beforeEach(() => resetRateLimits());
after(async () => { await close(); });

const filePath = (bid, invoiceId) =>
  `/api/businesses/${bid}/restaurant/invoices/${invoiceId}/file`;

const pdfDataUrl = (text) =>
  `data:application/pdf;base64,${Buffer.from(text).toString('base64')}`;

async function businessWithInvoice(label) {
  const owner = await ownerWithBusiness(email(label), 'Kitchen', { plan: 'business' });
  const bid = owner.business.id;
  const [tomato] = await createProducts(owner.cookie, bid, [
    { name: 'Tomato', sku: 'SKU-TOM', price: 2, cost: 0.5 },
  ]);
  const invoice = await createEntity(owner.cookie, 'SupplierInvoice', {
    business_id: bid,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-1',
    lines: [{ product_id: tomato.id, product_name: 'Tomato', quantity: 2, unit_cost: 3 }],
    total: 6,
    status: 'draft',
  });
  assert.equal(invoice.status, 201, invoice.text);
  return { owner, bid, invoiceId: invoice.json.id };
}

async function member(owner, label) {
  const memberEmail = email(label);
  const invite = await createEntity(owner.cookie, 'StaffMember', {
    business_id: owner.business.id,
    full_name: 'Manager',
    email: memberEmail,
    role_id: 'preset-manager',
    role_name: 'Manager',
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(memberEmail);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      memberEmail,
    ])
  ).rows[0];
  return { ...account, memberId: row.id, email: memberEmail };
}

test('the cap is 25 MB, server constant and client mirror alike', () => {
  assert.equal(INVOICE_FILE_MAX_BYTES, 25 * 1024 * 1024);
  const client = fs.readFileSync(new URL('../../src/lib/invoiceFiles.js', import.meta.url), 'utf8');
  assert.match(client, /INVOICE_FILE_MAX_BYTES = 25 \* 1024 \* 1024/);
  const dialog = fs.readFileSync(
    new URL('../../src/components/restaurant/InvoiceDialog.jsx', import.meta.url),
    'utf8',
  );
  assert.match(dialog, /file\.size > INVOICE_FILE_MAX_BYTES/);
  assert.match(dialog, /ops\.invoices\.fileTooLarge/);
});

test('round trip: upload, metadata, bytes, replace, remove', async () => {
  const { owner, bid, invoiceId } = await businessWithInvoice('file-roundtrip');

  const empty = await req(filePath(bid, invoiceId), { cookie: owner.cookie });
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.file, null);

  const up = await req(filePath(bid, invoiceId), {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'farm-invoice.pdf', dataUrl: pdfDataUrl('%PDF-fake-one') },
  });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.file.filename, 'farm-invoice.pdf');
  assert.equal(up.json.file.content_type, 'application/pdf');
  assert.equal(up.json.file.size_bytes, Buffer.from('%PDF-fake-one').length);

  const bytes = await req(`${filePath(bid, invoiceId)}/bytes`, { cookie: owner.cookie });
  assert.equal(bytes.status, 200, bytes.text);
  assert.equal(bytes.text, '%PDF-fake-one');

  // Uploading again replaces the one paper copy.
  const up2 = await req(filePath(bid, invoiceId), {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'farm-invoice-2.pdf', dataUrl: pdfDataUrl('%PDF-fake-two') },
  });
  assert.equal(up2.status, 201, up2.text);
  assert.equal(up2.json.file.filename, 'farm-invoice-2.pdf');
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM supplier_invoice_files WHERE invoice_id = $1',
    [invoiceId],
  );
  assert.equal(rows[0].n, 1);

  const del = await req(filePath(bid, invoiceId), { method: 'DELETE', cookie: owner.cookie });
  assert.equal(del.status, 200, del.text);
  const gone = await req(`${filePath(bid, invoiceId)}/bytes`, { cookie: owner.cookie });
  assert.equal(gone.status, 404);
  assert.equal(gone.json.error, 'invoice_file_not_found');
});

test('refusals: oversize and wrong type carry the 25 MB wording', async () => {
  const { owner, bid, invoiceId } = await businessWithInvoice('file-refusals');

  const big = `data:application/pdf;base64,${Buffer.alloc(INVOICE_FILE_MAX_BYTES + 1).toString('base64')}`;
  const over = await req(filePath(bid, invoiceId), {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'big.pdf', dataUrl: big },
  });
  assert.equal(over.status, 400, over.text?.slice(0, 200));
  assert.equal(over.json.error, 'invoice_file_invalid');
  assert.match(over.json.message, /under 25 MB/);

  const html = await req(filePath(bid, invoiceId), {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'x.html', dataUrl: `data:text/html;base64,${Buffer.from('<b>x</b>').toString('base64')}` },
  });
  assert.equal(html.status, 400);
  assert.equal(html.json.error, 'invoice_file_invalid');
});

test('gates: unticked member reads but cannot write; Essentials is plan-gated; another business is a 404', async () => {
  const { owner, bid, invoiceId } = await businessWithInvoice('file-gates');
  const mgr = await member(owner, 'file-gates-mgr');

  const read = await req(filePath(bid, invoiceId), { cookie: mgr.cookie });
  assert.equal(read.status, 200, read.text);
  const write = await req(filePath(bid, invoiceId), {
    method: 'POST',
    cookie: mgr.cookie,
    body: { filename: 'a.pdf', dataUrl: pdfDataUrl('%PDF-x') },
  });
  assert.equal(write.status, 403, write.text);
  assert.equal(write.json.error, 'invoice_file_not_granted');

  const ess = await ownerWithBusiness(email('file-gates-ess'), 'Plain Shop', { plan: 'essentials' });
  const gated = await req(filePath(ess.business.id, invoiceId), { cookie: ess.cookie });
  assert.equal(gated.status, 403);
  assert.equal(gated.json.error, 'plan_gated');

  const other = await ownerWithBusiness(email('file-gates-other'), 'Other Kitchen', { plan: 'business' });
  const cross = await req(filePath(other.business.id, invoiceId), { cookie: other.cookie });
  assert.equal(cross.status, 404);
  assert.equal(cross.json.error, 'invoice_not_found');
});
