/**
 * T5 — print PDF endpoints (plan §2.12).
 *
 * Labels print on BOTH plans; packing slips, POs, supplier docs and
 * reports are Business-only, whatever the connection. Real PDFs:
 * %PDF header, non-trivial size, expected content strings. Printing
 * is blocked while the business is in grace (read-only).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  reqRaw,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  createSupplier,
  createPO,
  receive,
  enterGrace,
  assertPdf,
} from './helpers.js';

after(close);

async function setup(email, plan = 'business') {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', upc: '9781234567890', cost: 4, price: 10 },
  ]);
  await receive(owner.cookie, owner.business.id, product.id, location.id, 5);
  return { owner, location, product };
}

test('labels PDF works on Essentials AND Business — the connection is plan-free', async () => {
  for (const [plan, email] of [
    ['essentials', 'print-label-ess@example.com'],
    ['business', 'print-label-biz@example.com'],
  ]) {
    const { owner, product } = await setup(email, plan);
    const res = await reqRaw(
      `/api/businesses/${owner.business.id}/print/labels?product_ids=${product.id}&copies=2`,
      { cookie: owner.cookie },
    );
    assert.equal(res.status, 200, `labels PDF must be 200 on ${plan}`);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assertPdf(res.buffer, ['Cat Bookmark', 'BM-001', '9781234567890']);
  }
});

test('labels PDF refuses unknown product ids and empty requests; copies clamp at 20', async () => {
  const { owner, product } = await setup('print-label-bad@example.com');
  const ghost = await reqRaw(
    `/api/businesses/${owner.business.id}/print/labels?product_ids=missing-product`,
    { cookie: owner.cookie },
  );
  assert.equal(ghost.status, 404);
  const empty = await reqRaw(`/api/businesses/${owner.business.id}/print/labels`, {
    cookie: owner.cookie,
  });
  assert.equal(empty.status, 400);
  // Copies above the cap are clamped to 20, not refused.
  const clamped = await reqRaw(
    `/api/businesses/${owner.business.id}/print/labels?product_ids=${product.id}&copies=99`,
    { cookie: owner.cookie },
  );
  assert.equal(clamped.status, 200);
  assertPdf(clamped.buffer, ['Cat Bookmark']);
});

test('document PDFs are Business-only: 403 on Essentials, 200 on Business', async () => {
  const ess = await setup('print-doc-ess@example.com', 'essentials');
  const biz = await setup('print-doc-biz@example.com', 'business');
  // A PO + an order exist in the Business workspace for the documents.
  const supplier = await createSupplier(biz.owner.cookie, biz.owner.business.id);
  const po = await createPO(biz.owner.cookie, biz.owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: biz.location.id,
    lines: [
      { product_id: biz.product.id, product_name: biz.product.name, sku: biz.product.sku, qty_ordered: 4, qty_received: 0, unit_cost: 4 },
    ],
  });
  await req(`/api/businesses/${biz.owner.business.id}/purchase-orders/${po.id}/order`, {
    method: 'POST',
    cookie: biz.owner.cookie,
  });
  const order = await req('/api/entities/Order', {
    method: 'POST',
    body: {
      business_id: biz.owner.business.id,
      number: 'ORD-1001',
      customer_name: 'Test Customer',
      location_id: biz.location.id,
      lines: [{ product_id: biz.product.id, product_name: biz.product.name, sku: biz.product.sku, quantity: 2, price: 10 }],
      total: 20,
    },
    cookie: biz.owner.cookie,
  });
  assert.equal(order.status, 201);
  const docs = [
    [`/print/packing-slip?order_id=${order.json.id}`, ['ORD-1001']],
    [`/print/po?po_id=${po.id}&mode=po`, [po.number, 'Test Supplier']],
    [`/print/po?po_id=${po.id}&mode=packing`, [po.number]],
    [`/print/supplier-doc?supplier_id=${supplier.id}`, ['Test Supplier']],
    ['/print/report?type=stock&groupBy=product', ['Stock']],
  ];
  for (const [path, strings] of docs) {
    const refused = await reqRaw(`/api/businesses/${ess.owner.business.id}${path}`, {
      cookie: ess.owner.cookie,
    });
    assert.equal(refused.status, 403, `Essentials must be refused ${path}`);
    const allowed = await reqRaw(`/api/businesses/${biz.owner.business.id}${path}`, {
      cookie: biz.owner.cookie,
    });
    assert.equal(allowed.status, 200, `Business must get a PDF for ${path}`);
    assertPdf(allowed.buffer, strings);
  }
});

test('paper carries the store name, never the app name or logo', async () => {
  const { owner, location, product } = await setup('print-whitelabel@example.com', 'business');
  // A PO + an order exist so every document PDF can be checked, not
  // just the labels.
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: [
      { product_id: product.id, product_name: product.name, sku: product.sku, qty_ordered: 4, qty_received: 0, unit_cost: 4 },
    ],
  });
  const order = await req('/api/entities/Order', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      number: 'ORD-1001',
      customer_name: 'Test Customer',
      location_id: location.id,
      lines: [{ product_id: product.id, product_name: product.name, sku: product.sku, quantity: 2, price: 10 }],
      total: 20,
    },
    cookie: owner.cookie,
  });
  assert.equal(order.status, 201);
  // Every generated document: the business/store name is the header,
  // and the app name (or any app-logo reference) appears nowhere.
  // The small-app-mark exception is undecided, so it is left out.
  const docs = [
    `/print/labels?product_ids=${product.id}`,
    `/print/packing-slip?order_id=${order.json.id}`,
    `/print/po?po_id=${po.id}&mode=po`,
    `/print/po?po_id=${po.id}&mode=packing`,
    `/print/supplier-doc?supplier_id=${supplier.id}`,
    '/print/report?type=stock&groupBy=product',
  ];
  for (const path of docs) {
    const res = await reqRaw(`/api/businesses/${owner.business.id}${path}`, {
      cookie: owner.cookie,
    });
    assert.equal(res.status, 200, `expected a PDF for ${path}`);
    const text = res.buffer.toString('latin1');
    assert.ok(text.startsWith('%PDF-'), `${path} must be a real PDF`);
    assert.ok(text.includes('Test Shop'), `${path} should carry the store name`);
    assert.ok(!text.includes('Luminous StockHaven'), `${path} must not carry the app name`);
    assert.ok(!text.includes('Luminous'), `${path} must not mention the app at all`);
    assert.ok(!text.includes('ScanHaven'), `${path} must not carry the stale app name`);
    assert.ok(!/addImage|logo/i.test(text), `${path} must not carry an app-logo reference`);
  }
  // No browser-print template names the app or draws a logo on the
  // paper either — every one headers with the business/store name.
  const { readFileSync } = await import('node:fs');
  for (const file of [
    'src/components/print/CustomerDoc.jsx',
    'src/components/print/LabelCard.jsx',
    'src/components/print/PurchaseOrderDoc.jsx',
    'src/components/print/ReturnDoc.jsx',
    'src/components/print/DocHeader.jsx',
    'src/components/print/CountSheet.jsx',
    'src/components/print/PickList.jsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /Luminous|ScanHaven|Stockhaven|StockHaven/, `${file} must not name the app`);
    assert.doesNotMatch(source, /addImage|<img/, `${file} must not draw a logo`);
  }
  assert.match(
    readFileSync('src/components/print/DocHeader.jsx', 'utf8'),
    /business\?\.name/,
    'the document header is the business/store name',
  );
});

test('printing is blocked while the business is in grace', async () => {
  const { owner, product } = await setup('print-grace@example.com', 'business');
  await enterGrace(owner.business.id);
  const labels = await reqRaw(
    `/api/businesses/${owner.business.id}/print/labels?product_ids=${product.id}`,
    { cookie: owner.cookie },
  );
  assert.equal(labels.status, 403);
  assert.equal(JSON.parse(labels.text).error, 'grace_read_only');
});
