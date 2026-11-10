/**
 * T5 — stock valuation, advanced reports, exports (plan §2.11).
 *
 * Missing cost/price is never treated as zero — blank, never $0 —
 * on the valuation endpoint, in the server reports, and in the
 * server exports, and the three agree. Export cap 20,000 rows with
 * a "truncated" note; the full inventory workbook is Excel-only.
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
} from './helpers.js';

after(close);

async function stockedBusiness(email) {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, 'business', owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  const [withCost, noCost, noPrice] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Priced Bookmark', sku: 'PB-001', cost: 4, price: 10 },
    { name: 'Costless Notebook', sku: 'CN-001', price: 15 },
    { name: 'Priceless Pen', sku: 'PP-001', cost: 2 },
  ]);
  await receive(owner.cookie, owner.business.id, withCost.id, location.id, 10);
  await receive(owner.cookie, owner.business.id, noCost.id, location.id, 5);
  await receive(owner.cookie, owner.business.id, noPrice.id, location.id, 8);
  // A sale, so the movements report has something to count.
  await req(`/api/businesses/${owner.business.id}/movements`, {
    method: 'POST',
    body: { product_id: withCost.id, location_id: location.id, type: 'sale', quantity: 2 },
    cookie: owner.cookie,
  });
  return { owner, location, withCost, noCost, noPrice };
}

test('valuation leaves missing money blank, never $0', async () => {
  const { owner, withCost, noCost, noPrice } = await stockedBusiness('val-blank@example.com');
  const res = await req(`/api/businesses/${owner.business.id}/valuation`, { cookie: owner.cookie });
  assert.equal(res.status, 200);
  const bySku = new Map(res.json.rows.map((row) => [row.sku, row]));
  // withCost: 8 left after the sale of 2 → 8 × $4 = $32 cost, 8 × $10 = $80 retail.
  assert.equal(bySku.get('PB-001').costValue, 32);
  assert.equal(bySku.get('PB-001').retailValue, 80);
  assert.equal(bySku.get('PB-001').margin, 48);
  // Missing cost → blank cost value, not $0. Missing price → blank retail.
  assert.equal(bySku.get('CN-001').costValue, null);
  assert.equal(bySku.get('CN-001').retailValue, 75);
  assert.equal(bySku.get('PP-001').costValue, 16);
  assert.equal(bySku.get('PP-001').retailValue, null);
  assert.equal(bySku.get('PP-001').margin, null);
  assert.equal(res.json.totals.incomplete, true);
});

test('server reports match the server export figures', async () => {
  const { owner } = await stockedBusiness('rep-match@example.com');
  const report = await req(
    `/api/businesses/${owner.business.id}/reports?type=stock&groupBy=product`,
    { cookie: owner.cookie },
  );
  assert.equal(report.status, 200);
  const byLabel = new Map(report.json.rows.map((row) => [row.label, row]));
  // Stock report values count only known cost: PB-001 8 × $4 = $32.
  assert.equal(byLabel.get('Priced Bookmark').value, 32);
  assert.equal(byLabel.get('Priceless Pen').value, 16);
  // The costless product's 5 units are counted as missing, not as $0.
  assert.equal(report.json.missing.units, 5);
  assert.equal(report.json.missing.label, 'cost');
  assert.equal(report.json.totals.value, 48);
  // The valuation export carries the same figures.
  const csv = await reqRaw(`/api/businesses/${owner.business.id}/export/valuation?format=csv`, {
    cookie: owner.cookie,
  });
  assert.equal(csv.status, 200);
  const lines = csv.text.split('\n').filter(Boolean);
  const header = lines[0];
  assert.ok(header.includes('Cost value'));
  const priced = lines.find((line) => line.includes('Priced Bookmark'));
  assert.ok(priced.includes('32'), `valuation export should carry $32 for PB-001: ${priced}`);
  const costless = lines.find((line) => line.includes('Costless Notebook'));
  assert.ok(costless, 'costless product must appear in the export');
  // Its Cost value cell is blank, not 0 — the row still carries its retail value (5 × $15 = 75).
  assert.ok(costless.includes('75'), `costless retail value should be 75: ${costless}`);
  const costlessCells = costless.split(',');
  const costValueIndex = header.split(',').indexOf('Cost value');
  assert.equal(costlessCells[costValueIndex], '');
});

test('movements and sales reports count from the same ledger', async () => {
  const { owner } = await stockedBusiness('rep-moves@example.com');
  const moves = await req(
    `/api/businesses/${owner.business.id}/reports?type=movements&groupBy=type`,
    { cookie: owner.cookie },
  );
  assert.equal(moves.status, 200);
  const byLabel = new Map(moves.json.rows.map((row) => [row.label, row]));
  assert.ok(byLabel.has('Received'));
  assert.ok(byLabel.has('Sold'));
  assert.equal(byLabel.get('Sold').units, 2);
  const sales = await req(
    `/api/businesses/${owner.business.id}/reports?type=sales&groupBy=product`,
    { cookie: owner.cookie },
  );
  assert.equal(sales.status, 200);
  assert.equal(sales.json.rows[0].label, 'Priced Bookmark');
  assert.equal(sales.json.rows[0].units, 2);
  assert.equal(sales.json.rows[0].value, 20); // 2 × $10 retail
});

test('purchasing summary counts open orders and open value', async () => {
  const { owner, location, withCost } = await stockedBusiness('rep-po@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: [
      { product_id: withCost.id, product_name: withCost.name, sku: withCost.sku, qty_ordered: 10, qty_received: 0, unit_cost: 4 },
    ],
  });
  await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.id}/order`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  const summary = await req(`/api/businesses/${owner.business.id}/reports/purchasing`, {
    cookie: owner.cookie,
  });
  assert.equal(summary.status, 200);
  assert.equal(summary.json.orders, 1);
  assert.equal(summary.json.byStatus.ordered, 1);
  assert.equal(summary.json.openLines, 10);
  assert.equal(summary.json.openValue, 40);
  assert.equal(summary.json.bySupplier['Test Supplier'].orders, 1);
});

test('reports, valuation and exports are Business-only', async () => {
  const owner = await ownerWithBusiness('rep-ess@example.com');
  const bid = owner.business.id;
  for (const path of [
    `/api/businesses/${bid}/reports?type=stock`,
    `/api/businesses/${bid}/reports/purchasing`,
    `/api/businesses/${bid}/valuation`,
    `/api/businesses/${bid}/export/products`,
  ]) {
    const res = await req(path, { cookie: owner.cookie });
    assert.equal(res.status, 403, `${path} must refuse Essentials`);
  }
});

test('server exports: purchase-orders dataset, workbook Excel-only, row-count header', async () => {
  const { owner, location, withCost } = await stockedBusiness('exp-po@example.com');
  const supplier = await createSupplier(owner.cookie, owner.business.id);
  const po = await createPO(owner.cookie, owner.business.id, {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    location_id: location.id,
    lines: [
      { product_id: withCost.id, product_name: withCost.name, sku: withCost.sku, qty_ordered: 10, qty_received: 0, unit_cost: 4 },
    ],
  });
  const csv = await reqRaw(`/api/businesses/${owner.business.id}/export/purchase-orders?format=csv`, {
    cookie: owner.cookie,
  });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(po.number));
  assert.ok(csv.text.includes('Priced Bookmark'));
  assert.equal(csv.headers.get('x-export-rows'), '1');
  assert.equal(csv.headers.get('content-type').includes('text/csv'), true);
  // The workbook is Excel-only.
  const wbCsv = await reqRaw(
    `/api/businesses/${owner.business.id}/export/inventory-workbook?format=csv`,
    { cookie: owner.cookie },
  );
  assert.equal(wbCsv.status, 400);
  const wb = await reqRaw(
    `/api/businesses/${owner.business.id}/export/inventory-workbook?format=xlsx`,
    { cookie: owner.cookie },
  );
  assert.equal(wb.status, 200);
  assert.ok(wb.buffer.slice(0, 2).toString() === 'PK', 'workbook must be a real .xlsx (ZIP)');
  assert.ok(Number(wb.headers.get('x-export-rows')) >= 3);
});

test('the Exports page is rewired to the server endpoint', async () => {
  const { readFileSync } = await import('node:fs');
  const card = readFileSync('src/components/exports/ExportCard.jsx', 'utf8');
  assert.match(card, /apiDownload\(/);
  assert.match(card, /\/api\/businesses\/\$\{businessId\}\/export\/\$\{dataset\.id\}/);
  assert.match(card, /X-Export-Truncated|truncated/);
  assert.match(card, /stopped at 20,000 rows/);
  assert.doesNotMatch(card, /exportDataset\(/);
  const page = readFileSync('src/pages/Exports.jsx', 'utf8');
  assert.match(page, /<ExportCard/);
  assert.match(page, /truncated-20000/);
});
