/**
 * T6 — Product Delete pins (Nov 14, 2026, owner ruling): the row
 * menu gains a FOURTH option — Delete, always LAST, always RED —
 * for active and archived products alike. The menu tap alone never
 * deletes: a plain-words confirmation names the product and, when
 * it holds stock, states how many units on hand go with it; only an
 * explicit confirm deletes. The old admin trash button beside the
 * menu deleted INSTANTLY with no confirmation — it is gone; the
 * menu (same admin gate) is the only door. Past ledger movements
 * keep the product name recorded at the time (server/movements.js
 * snapshots product_name on every movement), so the business's
 * books stay readable after a delete.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync(
  new URL('../../src/components/products/ProductRowMenu.jsx', import.meta.url),
  'utf8',
);
const page = readFileSync(new URL('../../src/pages/Products.jsx', import.meta.url), 'utf8');
const movements = readFileSync(new URL('../../server/movements.js', import.meta.url), 'utf8');

test('menu: Delete renders LAST, in red, after archive/restore', () => {
  const archiveAt = menu.indexOf("t('products.archive')");
  const deleteAt = menu.indexOf("t('products.delete')");
  assert.ok(deleteAt !== -1, 'the Delete item exists');
  assert.ok(deleteAt > archiveAt, 'Delete comes after Archive');
  const deleteBlock = menu.slice(menu.lastIndexOf('<DropdownMenuItem', deleteAt), deleteAt);
  assert.ok(deleteBlock.includes('text-destructive'), 'Delete is styled destructive red');
  assert.ok(menu.includes('Trash2'), 'Delete carries the trash icon');
});

test('menu: Delete is offered for archived products too (outside the archive toggle)', () => {
  const toggleAt = menu.indexOf('onToggleArchive(product)');
  const deleteAt = menu.indexOf('onDelete(product)');
  assert.ok(deleteAt > toggleAt, 'the Delete item is not inside the archived/restore branch');
  assert.ok(menu.includes('{onDelete && ('), 'Delete renders whenever the page offers the door');
});

test('page: nothing deletes without the plain-words confirmation', () => {
  assert.ok(page.includes('const requestRemove = (product) => {'), 'the menu door routes through requestRemove');
  assert.ok(page.includes('if (!window.confirm(message)) return;'), 'a declined confirmation deletes nothing');
  assert.ok(
    page.indexOf('window.confirm(message)') < page.indexOf('remove(product);', page.indexOf('const requestRemove')),
    'the confirm runs before any delete call',
  );
});

test('page: the confirmation names the product and states its units on hand', () => {
  assert.ok(
    page.includes("t('products.deleteConfirmStock', { name: product.name, count: units })"),
    'a stocked product confirms with its unit count',
  );
  assert.ok(
    page.includes("t('products.deleteConfirm', { name: product.name })"),
    'an unstocked product confirms by name',
  );
  assert.ok(page.includes('.reduce((sum, l) => sum + (l.quantity || 0), 0)'), 'units are summed across its locations');
});

test('page: the instant-delete trash button is gone; the menu door keeps the admin gate', () => {
  assert.ok(!page.includes("t('products.deleteAria'"), 'no standalone delete button remains');
  assert.ok(
    page.includes("onDelete={user?.role === 'admin' ? requestRemove : undefined}"),
    'Delete is offered to the business admin only, as the old button was',
  );
});

test('books stay readable: movements snapshot the product name at write time', () => {
  assert.ok(movements.includes('product_name'), 'the movement record carries product_name');
  assert.ok(movements.includes('product_name: product.name'), 'the snapshot is written from the product at the time');
});
