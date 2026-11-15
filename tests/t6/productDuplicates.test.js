/**
 * T6 — Duplicate recognition + the one counting rule (owner,
 * Nov 14, 2026): count = DISTINCT ORIGINAL products, any status.
 * A copy never counts; an archived original always counts; only a
 * true delete lowers the count. The rule is the Products pill, the
 * server cap, the Overview's Active SKUs and its limit hint alike.
 *
 * Her exact live catalog is the acceptance shape: Red Bull RB-1
 * (active, 10 on hand), its copy RB-1-COPY (archived, 0), Cool
 * Ranch Doritos (17), Little Ibuprofen (20) — Active SKUs must
 * read 3 with the copy active OR archived, while Units on hand
 * stays 47 (a levels sum this item never touches).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { close, req, ownerWithBusiness, createProducts } from './helpers.js';
import {
  isDuplicateProduct,
  countDistinctProducts,
} from '../../src/lib/productDuplicates.js';

after(close);

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const RED_BULL = { id: 'p-rb', name: '16oz Redbull', sku: 'RB-1', upc: '611269546019', barcode: '611269546019', qr_code: '', status: 'active' };
const RB_COPY_ARCHIVED = { id: 'p-rb-copy', name: '16oz Redbull (copy)', sku: 'RB-1-COPY', upc: '', barcode: '', qr_code: '', status: 'archived' };
const DORITOS = { id: 'p-dor', name: 'Cool Ranch Doritos', sku: 'COOL-RANCH-DORI', upc: '028400091510', barcode: '028400091510', qr_code: '', status: 'active' };
const IBUPROFEN = { id: 'p-ibu', name: 'Little Ibuprofen', sku: 'LITTLE-IBUPROFEN', upc: '3111957486343', barcode: '3111957486343', qr_code: '', status: 'active' };

test('her catalog: the legacy copy is recognized by its birthmarks, the originals are not', () => {
  assert.equal(isDuplicateProduct(RED_BULL), false);
  assert.equal(isDuplicateProduct(RB_COPY_ARCHIVED), true, 'a -COPY SKU with cleared codes is a copy');
  assert.equal(isDuplicateProduct(DORITOS), false);
  assert.equal(isDuplicateProduct(IBUPROFEN), false);
  assert.equal(countDistinctProducts([RED_BULL, RB_COPY_ARCHIVED, DORITOS, IBUPROFEN]), 3,
    'Active SKUs reads 3 on her exact catalog');
});

test('her catalog: the copy restored to active still does not count', () => {
  const restored = { ...RB_COPY_ARCHIVED, status: 'active' };
  assert.equal(isDuplicateProduct(restored), true, 'status never decides copy-ness');
  assert.equal(countDistinctProducts([RED_BULL, restored, DORITOS, IBUPROFEN]), 3);
});

test('her catalog: an archived ORIGINAL still counts (archive is a shelf, not a shredder)', () => {
  const doritosArchived = { ...DORITOS, status: 'archived' };
  assert.equal(countDistinctProducts([RED_BULL, RB_COPY_ARCHIVED, doritosArchived, IBUPROFEN]), 3,
    'archiving the Doritos must not drop the count to 2');
});

test('the marker wins: a marked copy counts never, even if its codes are re-entered', () => {
  const marked = { ...RB_COPY_ARCHIVED, duplicate_of: 'p-rb', upc: '611269546019', barcode: '611269546019' };
  assert.equal(isDuplicateProduct(marked), true);
  const markedPlainSku = { id: 'p-x', name: 'Copy', sku: 'PLAIN-1', upc: '123', duplicate_of: 'p-rb', status: 'active' };
  assert.equal(isDuplicateProduct(markedPlainSku), true, 'the marker alone is proof enough');
});

test('the legacy signature needs BOTH birthmarks', () => {
  assert.equal(isDuplicateProduct({ sku: 'WIDGET-COPY', upc: '999', barcode: '', qr_code: '' }), false,
    'a -COPY SKU with a code still on it is not proven a copy');
  assert.equal(isDuplicateProduct({ sku: 'COPYCAT-1', upc: '', barcode: '', qr_code: '' }), false,
    'COPY inside a SKU is not the suffix');
  assert.equal(isDuplicateProduct({ sku: 'RB-1-COPY-2', upc: '', barcode: '', qr_code: '' }), true,
    'the clash-numbered second copy carries the same birthmarks');
  assert.equal(isDuplicateProduct({ sku: 'rb-1-copy', upc: '', barcode: '', qr_code: '' }), true,
    'the suffix match is case-insensitive');
  assert.equal(isDuplicateProduct(null), false);
  assert.equal(countDistinctProducts([]), 0);
});

test('the reverse pins: create adds, archive holds, duplicate holds, delete lowers', () => {
  let catalog = [RED_BULL, RB_COPY_ARCHIVED, DORITOS, IBUPROFEN];
  assert.equal(countDistinctProducts(catalog), 3);
  const NEW = { id: 'p-new', name: 'New Thing', sku: 'NEW-1', upc: '111', status: 'active' };
  catalog = [...catalog, NEW];
  assert.equal(countDistinctProducts(catalog), 4, 'a new distinct product raises the count');
  catalog = catalog.map((p) => (p.id === 'p-new' ? { ...p, status: 'archived' } : p));
  assert.equal(countDistinctProducts(catalog), 4, 'archiving it holds the count');
  const NEW_COPY = { id: 'p-new-copy', name: 'New Thing (copy)', sku: 'NEW-1-COPY', upc: '', barcode: '', qr_code: '', duplicate_of: 'p-new', status: 'active' };
  catalog = [...catalog, NEW_COPY];
  assert.equal(countDistinctProducts(catalog), 4, 'duplicating holds the count, copy active');
  catalog = catalog.map((p) => (p.id === 'p-new-copy' ? { ...p, status: 'archived' } : p));
  assert.equal(countDistinctProducts(catalog), 4, 'and copy archived');
  catalog = catalog.filter((p) => p.id !== 'p-new');
  assert.equal(countDistinctProducts(catalog), 3, 'a true delete of an original lowers the count');
});

test('the marker round-trips through the real create + read path (migration 024)', async () => {
  const { cookie, business } = await ownerWithBusiness('dup-marker@example.com');
  const [original] = await createProducts(cookie, business.id, [
    { name: 'Original', sku: 'ORG-1', upc: '555' },
  ]);
  assert.equal(original.duplicate_of, '', 'an ordinary product is born unmarked');
  const [copy] = await createProducts(cookie, business.id, [
    { name: 'Original (copy)', sku: 'ORG-1-COPY', upc: '', barcode: '', qr_code: '', duplicate_of: original.id },
  ]);
  assert.equal(copy.duplicate_of, original.id, 'the created copy carries the marker');
  const page = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: business.id } },
    cookie,
  });
  const readCopy = page.json.items.find((p) => p.id === copy.id);
  assert.equal(readCopy.duplicate_of, original.id, 'the marker survives a fresh read');
});

test('wiring: every surface reads the one definition', () => {
  const inventory = read('src/lib/inventory.js');
  assert.ok(inventory.includes('distinctSkus: countDistinctProducts(products)'),
    'summarize derives distinctSkus from the pure counter');
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.ok(dashboard.includes("label={t('dashboard.activeSkus')} value={stats.distinctSkus.toLocaleString()}"),
    'the Active SKUs card shows distinctSkus');
  assert.ok(dashboard.includes("stats.distinctSkus >= productLimit"),
    'the limit hint compares distinctSkus — the gate and the label agree');
  assert.ok(dashboard.includes("{ count: stats.distinctSkus, limit: productLimit }"),
    'the limit hint displays distinctSkus');
  const products = read('src/pages/Products.jsx');
  assert.ok(products.includes('setActiveCount(countDistinctProducts(totalDistinct.items ?? []))'),
    'the pill counts distinct originals from the full catalog read');
  assert.ok(!products.includes("Product.count(scoped({ status: { $ne: 'archived' } }"),
    'the pill no longer counts non-archived rows');
  assert.ok(products.includes('duplicate_of: product.duplicate_of || product.id'),
    'Duplicate stamps the marker, pointing at the original');
  const duplicateBody = products.slice(products.indexOf('const duplicate = async'), products.indexOf('const remove = async'));
  assert.ok(!duplicateBody.includes('atProductLimit'), 'Duplicate is not blocked at the cap — a copy consumes no slot');
  const migration = read('migrations/024_product_duplicate_of.sql');
  assert.ok(migration.includes('ALTER TABLE products ADD COLUMN IF NOT EXISTS duplicate_of'),
    'the marker column exists');
});

test('wiring: the server cap speaks the same rule', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes('export function isDuplicateProductRow(row)'), 'the server twin predicate exists');
  assert.ok(entities.includes('async function distinctProductCount(pool, businessId)'), 'the cap counts distinct originals');
  assert.ok(!entities.includes("status <> 'archived'"), 'the cap count no longer filters archived rows out');
  assert.ok(entities.includes('isDuplicateProductRow(values) ? 0 : 1'),
    'a create consumes a slot unless the incoming row is a copy — archived originals included');
  assert.ok(entities.includes('rows.filter((row) => !isDuplicateProductRow(row)).length'),
    'a bulk create counts only its distinct originals');
  assert.ok(!entities.includes("patch.status && patch.status !== 'archived'"),
    'restoring an archived product no longer re-checks the cap — it never left the count');
});
