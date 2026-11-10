/**
 * T5 — purchase orders (plan §2.11, audit Finding 21).
 *
 * Draft-first, never silently ordered; $0 lines warned, not silently
 * written; receiving through the atomic movements path; status moves
 * guarded server-side. Business-only throughout.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  createSupplier,
  createPO,
  onHand,
} from './helpers.js';

after(close);

async function businessSetup(email, plan = 'business') {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  return { owner, location };
}

function poLines(product, qty = 10, unitCost = 12.5) {
  return [
    {
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      qty_ordered: qty,
      qty_received: 0,
      unit_cost: unitCost,
    },
  ];
}

test('a purchase order is created as a draft, never silently ordered', async () => {
  const { owner, location } = await businessSetup('po-draft@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 12.5, price: 20 },
  ]);
  // Even when the browser asks for 'ordered', the server starts a draft.
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    status: 'ordered',
    location_id: location.id,
    location_name: location.name,
    lines: poLines(product),
  });
  assert.equal(po.status, 'draft');
  assert.equal(po.total, 125);
  assert.equal(po.subtotal, 125);
  // Drafts place explicitly, through the guarded transition.
  const placed = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(placed.status, 200);
  assert.equal(placed.json.order.status, 'ordered');
  // A placed order cannot be placed again.
  const again = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'invalid_po_status');
});

test('$0 lines are refused and named, not silently written', async () => {
  const { owner, location } = await businessSetup('po-zero@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'No Cost Notebook', sku: 'NC-001' },
  ]);
  const res = await req('/api/entities/PurchaseOrder', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      number: 'PO-ZERO-1',
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      status: 'draft',
      location_id: location.id,
      lines: poLines(product, 5, 0),
    },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'po_zero_cost_lines');
  assert.match(res.json.message, /No Cost Notebook/);
  // An explicit acknowledgement saves the $0 line on purpose.
  const confirmed = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: poLines(product, 5, 0),
    allow_zero_cost: true,
  });
  assert.equal(confirmed.status, 'draft');
  assert.equal(confirmed.lines[0].unit_cost, 0);
});

test('PO lifecycle: draft → ordered → partial receive → received, stock moves', async () => {
  const { owner, location } = await businessSetup('po-life@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 5, price: 20 },
  ]);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    location_name: location.name,
    lines: poLines(product, 10, 12.5),
  });
  // Receiving a draft is refused — place it first.
  const early = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`,
    { method: 'POST', body: { location_id: location.id, receipts: [4] }, cookie: owner.cookie },
  );
  assert.equal(early.status, 400);
  await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  // Receive 4 of 10: partial, stock lands, cost becomes what was paid.
  const partial = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`,
    { method: 'POST', body: { location_id: location.id, receipts: [4] }, cookie: owner.cookie },
  );
  assert.equal(partial.status, 200);
  assert.equal(partial.json.status, 'partial');
  assert.equal(partial.json.receivedNow, 4);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 4);
  const afterPartial = await req(`/api/entities/PurchaseOrder/${po.id}`, { cookie: owner.cookie });
  assert.equal(afterPartial.json.lines[0].qty_received, 4);
  const productNow = await req(`/api/entities/Product/${product.id}`, { cookie: owner.cookie });
  assert.equal(productNow.json.cost, 12.5);
  // Over-receiving is refused and writes nothing.
  const over = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`,
    { method: 'POST', body: { location_id: location.id, receipts: [7] }, cookie: owner.cookie },
  );
  assert.equal(over.status, 400);
  assert.equal(await onHand(owner.business.id, product.id, location.id), 4);
  // Receive the rest: complete.
  const done = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`,
    { method: 'POST', body: { location_id: location.id, receipts: [6] }, cookie: owner.cookie },
  );
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'received');
  assert.equal(await onHand(owner.business.id, product.id, location.id), 10);
  // A received order takes no more stock.
  const late = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`,
    { method: 'POST', body: { location_id: location.id, receipts: [1] }, cookie: owner.cookie },
  );
  assert.equal(late.status, 400);
});

test('a received order cannot be edited back to draft, and cancel is refused after receiving', async () => {
  const { owner, location } = await businessSetup('po-guard@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 5, price: 20 },
  ]);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: poLines(product, 4, 12.5),
  });
  await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/receive`, {
    method: 'POST',
    body: { location_id: location.id, receipts: [2] },
    cookie: owner.cookie,
  });
  const edit = await req(`/api/entities/PurchaseOrder/${po.id}`, {
    method: 'PATCH',
    body: { status: 'draft' },
    cookie: owner.cookie,
  });
  assert.equal(edit.status, 400);
  assert.equal(edit.json.error, 'invalid_po_status');
  const cancel = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po.id}/cancel`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(cancel.status, 400);
  // But a draft with nothing received cancels cleanly.
  const po2 = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: poLines(product, 2, 12.5),
  });
  const cancelled = await req(
    `/api/businesses/${owner.business.id}/purchase-orders/${po2.id}/cancel`,
    { method: 'POST', cookie: owner.cookie },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.order.status, 'cancelled');
});

test('purchase orders and suppliers are Business-only, server-side', async () => {
  const { owner, location } = await businessSetup('po-ess@example.com', 'essentials');
  const supplier = await req('/api/entities/Supplier', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Nope Supplier' },
    cookie: owner.cookie,
  });
  assert.equal(supplier.status, 403);
  assert.equal(supplier.json.error, 'supplier_business_only');
  const po = await req('/api/entities/PurchaseOrder', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      number: 'PO-ESS-1',
      supplier_id: 'x',
      supplier_name: 'Nope',
      lines: [{ product_id: 'x', qty_ordered: 1, unit_cost: 1 }],
    },
    cookie: owner.cookie,
  });
  assert.equal(po.status, 403);
  assert.equal(po.json.error, 'plan_gated');
  // Essentials reads skip silently (the list pattern): empty, never a leak.
  const list = await req('/api/entities/PurchaseOrder/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: owner.cookie,
  });
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 0);
  void location;
});
