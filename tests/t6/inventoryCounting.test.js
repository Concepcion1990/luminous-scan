/**
 * T6 — My inventory card counting (owner ruling, Nov 14, 2026):
 * the "PRODUCTS STOCKED n OF N" card and the LOW STOCK card follow
 * the one counting rule — a copy is not a product, so it belongs in
 * NEITHER stocked number, and it never cries low-stock.
 *
 * Her live catch: the card read "3 OF 4" (the 4 counted the Red Bull
 * copy) and LOW STOCK read 1 while nothing real was low. The low
 * mechanism, verified in source: Duplicate spreads the source
 * product, so the copy inherits the original's reorder point; at
 * 0 units it satisfies qty <= reorder_point the moment it is
 * restored to active (while archived it is filtered off the page,
 * which is why the card read 0 then). RB-1 itself never trips: its
 * 10 units sit above the same reorder point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { countDistinctProducts, isDuplicateProduct } from '../../src/lib/productDuplicates.js';

const page = readFileSync(new URL('../../src/pages/Inventory.jsx', import.meta.url), 'utf8');

// Her shelf, all four rows active: three originals holding stock and
// the copy at 0 units carrying RB-1's inherited reorder point.
const RB1 = { id: 'rb1', name: '16oz Redbull', sku: 'RB-1', upc: '611269546019', barcode: '', qr_code: '', status: 'active', reorder_point: 5, duplicate_of: '' };
const COPY = { id: 'rb1-copy', name: '16oz Redbull (copy)', sku: 'RB-1-COPY', upc: '', barcode: '', qr_code: '', status: 'active', reorder_point: 5, duplicate_of: '' };
const DORITOS = { id: 'doritos', name: 'Cool Ranch Doritos', sku: '', upc: '028400091510', barcode: '028400091510', qr_code: '', status: 'active', reorder_point: 0, duplicate_of: '' };
const IBUPROFEN = { id: 'ibu', name: 'Little Ibuprofen', sku: 'LITTLE-IBUPROFEN', upc: '3111957486343', barcode: '3111957486343', qr_code: '', status: 'active', reorder_point: 0, duplicate_of: '' };
const SHELF = [RB1, COPY, DORITOS, IBUPROFEN];
const QTY = { rb1: 10, 'rb1-copy': 0, doritos: 17, ibu: 20 };

// The page's own predicates, mirrored line for line (the source pins
// below prove the page carries them).
const stockedCount = (rows) =>
  rows.filter((p) => !isDuplicateProduct(p) && QTY[p.id] > 0).length;
const lowCount = (rows) =>
  rows.filter((p) => {
    if (isDuplicateProduct(p)) return false;
    if (!p.reorder_point) return false;
    return QTY[p.id] <= p.reorder_point;
  }).length;

test('acceptance: her shelf reads stocked 3 of 3, units untouched', () => {
  assert.equal(stockedCount(SHELF), 3, 'three originals hold stock; the copy at 0 units is not stocked');
  assert.equal(countDistinctProducts(SHELF), 3, 'the OF number counts distinct originals only');
  assert.equal(
    Object.values(QTY).reduce((a, b) => a + b, 0),
    47,
    'units on hand is a levels sum — the copy rule never touches it',
  );
});

test('low stock: the copy never cries low-stock, even holding an inherited reorder point', () => {
  // Without the exclusion the copy WOULD trip the rule — this is the
  // exact mechanism behind her live "LOW STOCK 1".
  const withoutExclusion = SHELF.filter((p) => p.reorder_point && QTY[p.id] <= p.reorder_point);
  assert.deepEqual(withoutExclusion.map((p) => p.id), ['rb1-copy'], 'the copy alone trips the bare rule');
  assert.equal(lowCount(SHELF), 0, 'with the exclusion, nothing on her shelf is low');
});

test('low stock: a genuinely low ORIGINAL still counts', () => {
  const lowOriginal = { ...IBUPROFEN, reorder_point: 25 };
  assert.equal(lowCount([RB1, COPY, DORITOS, lowOriginal]), 1, 'an original at/below its reorder point still reads low');
});

test('page wiring: Inventory.jsx applies the exclusion to all three numbers', () => {
  assert.ok(
    page.includes("import { countDistinctProducts, isDuplicateProduct } from '@/lib/productDuplicates';"),
    'the page imports the shared counting rule',
  );
  assert.ok(page.includes('!isDuplicateProduct(row.product)'), 'stocked excludes copies');
  assert.ok(page.includes('if (isDuplicateProduct(product)) return false;'), 'low-stock excludes copies');
  assert.ok(
    page.includes('count: countDistinctProducts(products)'),
    'the OF denominator counts distinct originals, not rows',
  );
  assert.ok(!page.includes('count: products.length'), 'the old row-count denominator is gone');
});
