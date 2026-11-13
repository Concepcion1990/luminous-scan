/**
 * T14 — Send purchase orders from inside the app (Business only).
 *
 * The owner's requirement (Nov 12): a placed order can be emailed to
 * its supplier from the Purchasing page; the email and the attached
 * PDF carry ONLY the business's own name; a supplier with no email
 * on file blocks the send with a plain prompt; sending fails closed
 * while the mailer is not configured; and a send is recorded on the
 * order only after the mailer confirms it.
 *
 * Real Express app over HTTP against pg-mem, in-memory mail sink —
 * no real email is ever sent.
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
  setPlan,
  createLocation,
  createProducts,
  createSupplier,
  createPO,
  mailbox,
  mailToAddress,
} from './helpers.js';
import { __setMailSink } from '../../server/email.js';

after(close);
beforeEach(() => resetRateLimits());

const SUPPLIER_EMAIL = 'orders@acme-supplies.test';
const BUSINESS_NAME = 'Paws And Pages Gifts';

async function invite(cookie, businessId, member) {
  return req(`/api/businesses/${businessId}/staff`, {
    method: 'POST',
    body: { business_id: businessId, member },
    cookie,
  });
}

/** Business-plan shop with one supplier (email on file) and one product. */
async function sendSetup(email, { supplierEmail = SUPPLIER_EMAIL } = {}) {
  const owner = await ownerWithBusiness(email, BUSINESS_NAME);
  await setPlan(owner.business.id, 'business', owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  const supplier = await createSupplier(owner.cookie, owner.business.id, {
    name: 'Acme Supplies',
    email: supplierEmail,
  });
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 12.5, price: 20 },
  ]);
  return { owner, location, supplier, product };
}

async function placedPo({ owner, location, supplier, product }, overrides = {}) {
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    location_name: location.name,
    lines: [
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        qty_ordered: 10,
        qty_received: 0,
        unit_cost: 12.5,
      },
    ],
    ...overrides,
  });
  const placed = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(placed.status, 200);
  return placed.json.order;
}

function send(cookie, businessId, poId) {
  return req(`/api/businesses/${businessId}/purchase-orders/${poId}/send`, {
    method: 'POST',
    cookie,
  });
}

async function poRow(poId) {
  const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [poId]);
  return rows[0];
}

test('owner sends a placed PO: one white-label email, PDF attached, send recorded; a resend updates the record', async () => {
  const setup = await sendSetup('po-send-owner@example.com');
  const { owner } = setup;
  const po = await placedPo(setup);
  const before = mailToAddress(SUPPLIER_EMAIL).length;

  const res = await send(owner.cookie, owner.business.id, po.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.order.sent_to, SUPPLIER_EMAIL);
  assert.equal(res.json.order.send_count, 1);
  assert.ok(res.json.order.sent_at, 'sent_at is set');

  // Exactly one email went to the supplier, carrying the business's
  // name only — the app's name appears NOWHERE.
  const sent = mailToAddress(SUPPLIER_EMAIL);
  assert.equal(sent.length, before + 1);
  const mail = sent[sent.length - 1];
  assert.ok(mail.subject.includes(po.number));
  assert.ok(mail.subject.includes(BUSINESS_NAME));
  assert.ok(mail.text.includes(BUSINESS_NAME));
  assert.ok(!/stockhaven/i.test(mail.subject), 'subject carries no app branding');
  assert.ok(!/stockhaven/i.test(mail.text), 'body carries no app branding');
  assert.ok(!/stockhaven/i.test(mail.html || ''), 'html carries no app branding');

  // The PO PDF is attached, white-label like the printed document.
  assert.equal(mail.attachments.length, 1);
  const [attachment] = mail.attachments;
  assert.equal(attachment.filename, `purchase-order-${po.number}.pdf`);
  const pdfText = Buffer.from(attachment.content).toString('latin1');
  assert.ok(pdfText.startsWith('%PDF-'), 'attachment is a real PDF');
  assert.ok(pdfText.includes(BUSINESS_NAME), 'PDF carries the business name');
  assert.ok(!/stockhaven/i.test(pdfText), 'PDF carries no app branding');

  // The record is on the order itself.
  const row = await poRow(po.id);
  assert.equal(row.sent_to, SUPPLIER_EMAIL);
  assert.equal(Number(row.send_count), 1);
  assert.ok(row.sent_at);

  // Re-sending is allowed and updates the same record.
  const again = await send(owner.cookie, owner.business.id, po.id);
  assert.equal(again.status, 200);
  assert.equal(again.json.order.send_count, 2);
  assert.equal(mailToAddress(SUPPLIER_EMAIL).length, before + 2);
  const rowAfter = await poRow(po.id);
  assert.ok(new Date(rowAfter.sent_at) >= new Date(row.sent_at));
});

test('a draft PO cannot be sent, and neither can a cancelled one', async () => {
  const setup = await sendSetup('po-send-draft@example.com');
  const { owner, location, supplier, product } = setup;
  const draft = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: [
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        qty_ordered: 4,
        qty_received: 0,
        unit_cost: 12.5,
      },
    ],
  });
  assert.equal(draft.status, 'draft');
  const before = mailToAddress(SUPPLIER_EMAIL).length;

  const draftRes = await send(owner.cookie, owner.business.id, draft.id);
  assert.equal(draftRes.status, 400);
  assert.equal(draftRes.json.error, 'invalid_po_status');
  assert.match(draftRes.json.message, /draft/i);

  const cancelled = await placedPo(setup);
  const cancelRes = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${cancelled.id}/cancel`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(cancelRes.status, 200);
  const cancelledRes = await send(owner.cookie, owner.business.id, cancelled.id);
  assert.equal(cancelledRes.status, 400);
  assert.equal(cancelledRes.json.error, 'invalid_po_status');

  assert.equal(mailToAddress(SUPPLIER_EMAIL).length, before, 'nothing was emailed');
});

test('supplier without an email on file: the send is blocked with a plain prompt, nothing sent, nothing recorded', async () => {
  const setup = await sendSetup('po-send-noemail@example.com', { supplierEmail: '' });
  const { owner } = setup;
  const po = await placedPo(setup);

  const res = await send(owner.cookie, owner.business.id, po.id);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'supplier_email_missing');
  assert.match(res.json.message, /add the email/i);
  assert.match(res.json.message, /Acme Supplies/);

  const row = await poRow(po.id);
  assert.equal(row.sent_to, '');
  assert.equal(Number(row.send_count), 0);
  assert.equal(row.sent_at, null);
});

test('Essentials cannot reach the send endpoint (plan gate)', async () => {
  const setup = await sendSetup('po-send-essentials@example.com');
  const { owner } = setup;
  const po = await placedPo(setup);
  await setPlan(owner.business.id, 'essentials', owner.user.id);

  const res = await send(owner.cookie, owner.business.id, po.id);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'plan_gated');
});

test('staff without purchasing permission is refused; a manager can send', async () => {
  const setup = await sendSetup('po-send-staff@example.com');
  const { owner } = setup;
  const po = await placedPo(setup);

  const salesInvite = await invite(owner.cookie, owner.business.id, {
    full_name: 'Sales Person',
    email: 'po-send-sales@example.com',
    role_id: 'preset-sales',
    role_name: 'Sales clerk',
    permissions: ['products.view', 'scan.use', 'orders.manage'],
    status: 'invited',
  });
  assert.equal(salesInvite.status, 201, salesInvite.text);
  const sales = await registerVerifiedUser('po-send-sales@example.com');
  const refused = await send(sales.cookie, owner.business.id, po.id);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'forbidden');

  const mgrInvite = await invite(owner.cookie, owner.business.id, {
    full_name: 'Manager Person',
    email: 'po-send-manager@example.com',
    role_id: 'preset-manager',
    role_name: 'Manager',
    status: 'invited',
  });
  assert.equal(mgrInvite.status, 201, mgrInvite.text);
  const manager = await registerVerifiedUser('po-send-manager@example.com');
  const before = mailToAddress(SUPPLIER_EMAIL).length;
  const allowed = await send(manager.cookie, owner.business.id, po.id);
  assert.equal(allowed.status, 200, allowed.text);
  assert.equal(allowed.json.order.sent_to, SUPPLIER_EMAIL);
  assert.equal(mailToAddress(SUPPLIER_EMAIL).length, before + 1);
});

test('mailer not configured: the send fails closed with a plain message and nothing is recorded', async () => {
  const setup = await sendSetup('po-send-nomailer@example.com');
  const { owner } = setup;
  const po = await placedPo(setup);

  __setMailSink(null);
  try {
    const res = await send(owner.cookie, owner.business.id, po.id);
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'email_not_configured');
    assert.match(res.json.message, /isn't switched on/i);
    assert.match(res.json.message, /not sent/i);
  } finally {
    __setMailSink(async (message) => {
      mailbox.push(message);
    });
  }

  const row = await poRow(po.id);
  assert.equal(row.sent_to, '');
  assert.equal(Number(row.send_count), 0);
  assert.equal(row.sent_at, null);
});

test('the send record cannot be forged through the entity API', async () => {
  const setup = await sendSetup('po-send-forge@example.com');
  const { owner, location, supplier, product } = setup;

  // Create: any browser-supplied send fields start clean.
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: [
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        qty_ordered: 2,
        qty_received: 0,
        unit_cost: 12.5,
      },
    ],
    sent_to: 'forged@example.com',
    send_count: 7,
  });
  assert.equal(po.sent_to, '');
  assert.equal(po.send_count, 0);
  assert.equal(po.sent_at, null);

  // Update: touching the send record directly is refused.
  const patch = await req(`/api/entities/PurchaseOrder/${po.id}`, {
    method: 'PATCH',
    body: { sent_to: 'forged@example.com' },
    cookie: owner.cookie,
  });
  assert.equal(patch.status, 400);
  assert.equal(patch.json.error, 'po_send_via_endpoint');
});
