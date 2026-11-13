/**
 * T3 import + export — server-side CSV import (cap, duplicates,
 * batch idempotency), export blocked on Essentials / allowed on
 * Business, CSV content parity, and ExcelJS .xlsx export that opens
 * again with leading-zero codes intact. Real Express app over HTTP
 * against pg-mem.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createLocation,
  createProducts,
  receive,
  setPlan,
  reqRaw,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function setup(email, plan = null) {
  const owner = await ownerWithBusiness(email);
  if (plan) await setPlan(owner.business.id, plan, owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id, { name: 'Main store' });
  return { ...owner, location };
}

async function importRows(cookie, businessId, body) {
  return req(`/api/businesses/${businessId}/import`, { method: 'POST', body, cookie });
}

test('CSV-style import creates products and receives stock in one call', async () => {
  const { cookie, business, location } = await setup('imp-basic@example.com');
  const res = await importRows(cookie, business.id, {
    rows: [
      { name: 'Bookmark', sku: 'BM-1', price: 9, cost: 2, stock_qty: 10 },
      { name: 'Notepad', sku: 'NP-1', price: 7, stock_qty: 5 },
    ],
    location_id: location.id,
    batchRef: 'BATCH-1',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.created, 2);
  assert.equal(res.json.received, 2);
  assert.equal(res.json.units, 15);
  assert.equal(res.json.skipped, 0);

  const levels = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: business.id } },
    cookie,
  });
  assert.equal(levels.json.items.length, 2);
  const quantities = levels.json.items.map((row) => Number(row.quantity)).sort((a, b) => a - b);
  assert.deepEqual(quantities, [5, 10]);
});

test('import refuses a second recording of the same batch (no double receive)', async () => {
  const { cookie, business, location } = await setup('imp-batch@example.com');
  const body = {
    rows: [{ name: 'Bookmark', sku: 'BM-1', stock_qty: 4 }],
    location_id: location.id,
    batchRef: 'BATCH-9',
  };
  const first = await importRows(cookie, business.id, body);
  assert.equal(first.status, 201);
  const second = await importRows(cookie, business.id, body);
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'already_imported');
  const levels = await req('/api/entities/StockLevel/query', {
    method: 'POST',
    body: { filter: { business_id: business.id } },
    cookie,
  });
  assert.equal(Number(levels.json.items[0].quantity), 4, 'stock was received exactly once');
});

test('import reports duplicate SKUs and codes as problems and skips them', async () => {
  const { cookie, business, location } = await setup('imp-dup@example.com');
  await createProducts(cookie, business.id, [{ name: 'Existing', sku: 'BM-1', upc: '111' }]);
  const res = await importRows(cookie, business.id, {
    rows: [
      { name: 'Copy SKU', sku: 'BM-1', stock_qty: 1 },
      { name: 'Copy UPC', sku: 'NEW-1', upc: '111', stock_qty: 1 },
      { name: 'Good one', sku: 'GOOD-1', stock_qty: 2 },
      { name: 'Batch dup', sku: 'GOOD-1', stock_qty: 1 },
      { name: '', sku: 'NONAME-1' },
    ],
    location_id: location.id,
    batchRef: 'BATCH-DUP',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.created, 1);
  assert.equal(res.json.skipped, 4);
  assert.equal(res.json.problems.length, 4);
  assert.match(res.json.problems[0].problem, /already in the catalog/);
});

test('import enforces the Essentials product cap', async () => {
  const { cookie, business, location } = await setup('imp-cap@example.com');
  await createProducts(cookie, business.id, Array.from({ length: 49 }, (_, i) => ({ name: `P${i}`, sku: `S-${i}` })));
  const res = await importRows(cookie, business.id, {
    rows: [
      { name: 'Fits', sku: 'FIT-1' },
      { name: 'Over', sku: 'OVER-1' },
    ],
    location_id: location.id,
    batchRef: 'BATCH-CAP',
  });
  assert.equal(res.json.created, 1);
  assert.equal(res.json.skipped, 1);
  assert.match(res.json.problems[0].problem, /50 active products/);
});

test('export is refused on Essentials (403) and works on Business', async () => {
  const ess = await setup('exp-ess@example.com');
  await createProducts(ess.cookie, ess.business.id, [{ name: 'Bookmark', sku: 'BM-1', price: 9, cost: 2 }]);
  const denied = await reqRaw(`/api/businesses/${ess.business.id}/export/products?format=csv`, {
    cookie: ess.cookie,
  });
  assert.equal(denied.status, 403);

  const biz = await setup('exp-biz@example.com', 'business');
  await createProducts(biz.cookie, biz.business.id, [
    { name: 'Bookmark', sku: '00123', price: 9, cost: 2 },
    { name: 'Notepad', sku: 'NP-1', price: 7 },
  ]);
  await receive(biz.cookie, biz.business.id,
    (await req('/api/entities/Product/query', { method: 'POST', body: { filter: { business_id: biz.business.id, sku: '00123' } }, cookie: biz.cookie })).json.items[0].id,
    biz.location.id, 4);

  const csv = await reqRaw(`/api/businesses/${biz.business.id}/export/products?format=csv`, {
    cookie: biz.cookie,
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /\.csv/);
  const lines = csv.text.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines[0].split(',')[0], 'Product ID');
  assert.equal(lines.length, 3, 'header + 2 products');
  assert.ok(lines[1].includes('Bookmark'));
  // The leading-zero SKU survives as a quoted text formula guard in CSV.
  assert.ok(lines[1].includes('"=""00123"""'), 'leading-zero code is protected in CSV');

  const xlsx = await reqRaw(`/api/businesses/${biz.business.id}/export/products?format=xlsx`, {
    cookie: biz.cookie,
  });
  assert.equal(xlsx.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('B1').value, 'Name');
  const skuCell = sheet.getCell('C2');
  assert.equal(skuCell.value, '00123');
  assert.equal(typeof skuCell.value, 'string', 'SKU stays text in the workbook');
});

test('valuation export leaves money blank when no cost or price is recorded', async () => {
  const biz = await setup('exp-val@example.com', 'business');
  const [priced, unpriced] = await createProducts(biz.cookie, biz.business.id, [
    { name: 'Priced', sku: 'P-1', price: 10, cost: 4 },
    { name: 'Unpriced', sku: 'U-1' },
  ]);
  await receive(biz.cookie, biz.business.id, priced.id, biz.location.id, 3);
  await receive(biz.cookie, biz.business.id, unpriced.id, biz.location.id, 2);

  const valuation = await req(`/api/businesses/${biz.business.id}/valuation`, {
    method: 'GET',
    cookie: biz.cookie,
  });
  assert.equal(valuation.status, 200);
  assert.equal(valuation.json.rows.length, 2);
  const pricedRow = valuation.json.rows.find((row) => row.sku === 'P-1');
  assert.equal(pricedRow.costValue, 12);
  assert.equal(pricedRow.retailValue, 30);
  assert.equal(pricedRow.margin, 18);
  const unpricedRow = valuation.json.rows.find((row) => row.sku === 'U-1');
  assert.equal(unpricedRow.costValue, null, 'no cost is blank, never $0');
  assert.equal(unpricedRow.retailValue, null);
  assert.equal(unpricedRow.margin, null);
  assert.equal(valuation.json.totals.incomplete, true);

  const csv = await reqRaw(`/api/businesses/${biz.business.id}/export/valuation?format=csv`, {
    cookie: biz.cookie,
  });
  assert.equal(csv.status, 200);
  const lines = csv.text.replace(/^\uFEFF/, '').split('\r\n');
  const unpricedLine = lines.find((line) => line.includes('Unpriced'));
  assert.ok(unpricedLine, 'unpriced row is in the export');
  // Cost value / Retail value / Margin columns are empty for it.
  const header = lines[0].split(',');
  const costIdx = header.indexOf('Cost value');
  assert.equal(unpricedLine.split(',')[costIdx], '');
});

test('valuation is Business-only on the endpoint too', async () => {
  const ess = await setup('exp-val-ess@example.com');
  const res = await req(`/api/businesses/${ess.business.id}/valuation`, { method: 'GET', cookie: ess.cookie });
  assert.equal(res.status, 403);
});

test('the full inventory workbook is Excel-only and has one sheet per dataset', async () => {
  const biz = await setup('exp-wb@example.com', 'business');
  await createProducts(biz.cookie, biz.business.id, [{ name: 'Bookmark', sku: 'BM-1', price: 9 }]);
  const wb = await reqRaw(`/api/businesses/${biz.business.id}/export/inventory-workbook?format=xlsx`, {
    cookie: biz.cookie,
  });
  assert.equal(wb.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(wb.buffer);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.ok(names.includes('Products'));
  assert.ok(names.includes('Stock valuation'));
  assert.ok(names.includes('Stock by location'));
  assert.ok(names.includes('Movements'));
  const asCsv = await reqRaw(`/api/businesses/${biz.business.id}/export/inventory-workbook?format=csv`, {
    cookie: biz.cookie,
  });
  assert.equal(asCsv.status, 400);
});
