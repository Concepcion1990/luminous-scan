/**
 * T6 — The counting law + the category edit door on the category
 * surfaces (owner rulings, Nov 14, 2026):
 *  - Inventory by category: per-group product counts and low flags
 *    exclude copies (her Drinks read "2 PRODUCTS · 1 LOW · 10
 *    units" — the 2nd product and the low were both the Red Bull
 *    copy; the law reads 1 product, 0 low, 10 units).
 *  - Every row there carries a Set/Change category door opening a
 *    window with the shared combobox + Add-new window; saving
 *    re-files the row immediately.
 *  - Categories & tags: per-category counts exclude copies, and an
 *    Uncategorized bucket row appears iff at least one distinct
 *    original has no category — a bucket, not a vocabulary word
 *    (no edit, no delete), leading to Inventory by category.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isDuplicateProduct } from '../../src/lib/productDuplicates.js';

const byCategory = readFileSync(new URL('../../src/pages/InventoryCategories.jsx', import.meta.url), 'utf8');
const categoriesPage = readFileSync(new URL('../../src/pages/Categories.jsx', import.meta.url), 'utf8');
const editDialog = readFileSync(
  new URL('../../src/components/inventory/CategoryEditDialog.jsx', import.meta.url),
  'utf8',
);

// Her shelf (quantities per the owner's live pages).
const RB1 = { id: 'rb1', name: '16oz Redbull', sku: 'RB-1', upc: '611269546019', barcode: '', qr_code: '', category: 'Drinks', status: 'active', reorder_point: 2, duplicate_of: '' };
const COPY = { id: 'copy', name: '16oz Redbull (copy)', sku: 'RB-1-COPY', upc: '', barcode: '', qr_code: '', category: 'Drinks', status: 'active', reorder_point: 2, duplicate_of: '' };
const DORITOS = { id: 'doritos', name: 'Cool Ranch Doritos', sku: '', upc: '028400091510', barcode: '028400091510', qr_code: '', category: 'Chips', status: 'active', reorder_point: 0, duplicate_of: '' };
const FUNYUNS = { id: 'funyuns', name: 'Funyuns', sku: '', upc: '028400090841', barcode: '028400090841', qr_code: '', category: 'Chips', status: 'active', reorder_point: 0, duplicate_of: '' };
const IBUPROFEN = { id: 'ibu', name: 'Little Ibuprofen', sku: 'LITTLE-IBUPROFEN', upc: '3111957486343', barcode: '3111957486343', qr_code: '', category: '', status: 'active', reorder_point: 0, duplicate_of: '' };
const QTY = { rb1: 10, copy: 0, doritos: 17, funyuns: 14, ibu: 20 };

// The by-category rollup, mirrored line for line from the page.
function rollup(products) {
  const groups = new Map();
  for (const product of products) {
    const key = String(product.category || '').trim() || 'Uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    const onHand = QTY[product.id] || 0;
    groups.get(key).push({
      product,
      onHand,
      low: !isDuplicateProduct(product) && (product.reorder_point || 0) > 0 && onHand <= product.reorder_point,
    });
  }
  return [...groups.entries()].map(([name, items]) => ({
    name,
    count: items.filter((item) => !isDuplicateProduct(item.product)).length,
    units: items.reduce((sum, item) => sum + item.onHand, 0),
    low: items.filter((item) => item.low).length,
  }));
}

test('acceptance: Drinks reads 1 product, 0 low, 10 units; Chips reads 2 products, 31 units', () => {
  const groups = rollup([RB1, COPY, DORITOS, FUNYUNS, IBUPROFEN]);
  const drinks = groups.find((g) => g.name === 'Drinks');
  assert.deepEqual(
    { count: drinks.count, low: drinks.low, units: drinks.units },
    { count: 1, low: 0, units: 10 },
    'the copy adds neither a product nor a low to Drinks',
  );
  const chips = groups.find((g) => g.name === 'Chips');
  assert.deepEqual(
    { count: chips.count, low: chips.low, units: chips.units },
    { count: 2, low: 0, units: 31 },
    'two originals in Chips count in full',
  );
  const uncat = groups.find((g) => g.name === 'Uncategorized');
  assert.equal(uncat.count, 1, 'the Ibuprofen is the one uncategorized original');
});

test('by-category page wiring: the exclusion drives the header count and the low flags', () => {
  assert.ok(byCategory.includes('count: items.filter((item) => !isDuplicateProduct(item.product)).length'), 'group count excludes copies');
  assert.ok(byCategory.includes('!isDuplicateProduct(product) &&'), 'the low flag excludes copies');
  assert.ok(byCategory.includes('count: group.count'), 'the header prints the distinct count');
  assert.ok(!byCategory.includes('count: group.items.length'), 'the old row-count header is gone');
});

test('edit door: every row carries Set or Change category, opening the shared editor', () => {
  assert.ok(
    byCategory.includes("product.category ? t('inventory.changeCategory') : t('inventory.setCategory')"),
    'the door label switches on whether the product is filed',
  );
  assert.ok(byCategory.includes('<CategoryEditDialog'), 'the page renders the edit window');
  assert.ok(byCategory.includes("useDataFresh('inventory', '/inventory/categories', load)"), 'the page stays on the freshness bus');
  assert.ok(byCategory.includes("searchParams.get('group')"), 'a ?group= door can pre-open a group');
});

test('edit window: shared combobox + Add-new window + the no-silent-birth judge', () => {
  assert.ok(editDialog.includes("import VocabularyCombobox from '@/components/products/VocabularyCombobox';"), 'the shared combobox');
  assert.ok(editDialog.includes('<AddVocabularyDialog'), 'the Add-new window rides inside');
  assert.ok(editDialog.includes('judgeVocabularyValue({'), 'typed-but-unmatched text is judged, never silently born');
  assert.ok(
    editDialog.includes("base44.entities.Product.update(product.id, { category: verdict.value })"),
    'saving writes the judged category through the entity client (which announces on the bus)',
  );
  assert.ok(editDialog.includes("t('inventory.saveFailed')"), 'a failed save says so with the inventory string');
  assert.ok(!/can\(|entitlement|plan/i.test(editDialog), 'the door is plan-independent — both plans');
});

test('categories page: counts run on distinct originals only', () => {
  assert.ok(
    categoriesPage.includes('const countableProducts = products.filter((product) => !isDuplicateProduct(product));'),
    'copies are filtered before counting',
  );
  assert.ok(categoriesPage.includes('countByField(countableProducts,'), 'the per-category counts use the filtered list');
});

test('categories page: the Uncategorized bucket — present by the law, a door not a word', () => {
  assert.ok(categoriesPage.includes('const uncategorizedCount = countableProducts.filter('), 'the bucket counts distinct originals with no category');
  assert.ok(categoriesPage.includes('{uncategorizedCount > 0 && ('), 'the bucket renders only when something is unfiled');
  assert.ok(
    categoriesPage.includes('to="/inventory/categories?group=Uncategorized"'),
    'tapping the bucket opens Inventory by category at the Uncategorized group',
  );
  assert.ok(categoriesPage.includes("t('inventory.uncategorized')"), 'the bucket reuses the existing Uncategorized string');
  const bucket = categoriesPage.slice(categoriesPage.indexOf('{uncategorizedCount > 0 && ('));
  const bucketEnd = bucket.indexOf('{!loading && orphans.length > 0');
  const bucketBody = bucket.slice(0, bucketEnd);
  assert.ok(!bucketBody.includes('openEdit') && !bucketBody.includes('remove('), 'the bucket has no edit pencil and no delete — it is not a vocabulary word');
});
