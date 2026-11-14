/**
 * T6 — Product form pins (Nov 14, 2026):
 *  - Preferred supplier gets the SAME plan treatment as sale
 *    pricing: off-Business the polite Business-plan note replaces
 *    the dropdown, and the save payload omits supplier_id /
 *    supplier_name entirely, so a downgraded business's stored
 *    supplier is held untouched — never cleared by an unrelated
 *    edit. On Business the dropdown renders exactly as before.
 *  - Only the name is required to save; the old combined
 *    name-and-SKU message (which claimed the name was missing when
 *    only the SKU was) is gone from the save gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(
  new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url),
  'utf8',
);

test('supplier field: gated on the suppliers feature with the Business-plan note off-Business', () => {
  assert.ok(dialog.includes("const canSuppliers = can('suppliers');"), 'the form gates suppliers like pricing');
  assert.ok(dialog.includes("t('productForm.supplierBusinessOnly')"), 'the Business-plan note renders off-Business');
  assert.ok(dialog.includes('canSuppliers ? ('), 'the dropdown renders only when the plan allows suppliers');
});

test('supplier payload: omitted entirely off-Business so a held supplier_id is never altered', () => {
  assert.ok(
    dialog.includes('...(canSuppliers'),
    'supplier_id/supplier_name join the payload only on Business',
  );
  const occurrences = dialog.split('supplier_id: form.supplier_id').length - 1;
  assert.equal(occurrences, 1, 'supplier_id is sent from exactly one place: the Business-only spread');
  assert.ok(
    dialog.indexOf('supplier_id: form.supplier_id') > dialog.indexOf('...(canSuppliers'),
    'the single supplier_id send sits inside the canSuppliers spread',
  );
});

test('save gate: only the name is required, with its own accurate message', () => {
  assert.ok(dialog.includes("t('productForm.nameRequired')"), 'the name-only message is used');
  assert.ok(
    !dialog.includes("if (!form.name.trim() || !form.sku.trim())"),
    'the combined name+SKU refusal is gone',
  );
});

test('starting quantity: create-mode only, stocked as a receive movement at the chosen location', () => {
  assert.ok(dialog.includes('{!product && !createdProduct && ('), 'the quantity block renders only while creating');
  assert.ok(dialog.includes("t('productForm.quantityLabel')"), 'the quantity field is labeled');
  assert.ok(dialog.includes("t('productForm.quantityInvalid')"), 'invalid quantities get the plain refusal');
  assert.ok(dialog.includes('if (!/^\\d+$/.test(raw))'), 'only whole numbers of zero or more pass');
  assert.ok(dialog.includes("type: 'receive'"), 'the opening stock is a receive movement, never a bare write');
  assert.ok(dialog.includes('recordMovement({'), 'the movement goes through the shared funnel');
  assert.ok(dialog.includes('locations.length > 1'), 'a location choice appears only when there is a choice to make');
  assert.ok(dialog.includes("localStorage.getItem('stockroom.location')"), "the default location follows the scan flow's remembered location");
});
